import { describe, expect, it } from 'vitest'
import {
  MAX_AXIS_POINTS,
  MAX_TOTAL_RUNS,
  SWEEP_METRICS,
  SWEEP_VARS,
  aggregate,
  buildRecentActivity,
  buildSweepAxis,
  buildSweepPlan,
  getSweepVarMeta,
  localDateKey,
  summarizeSweep,
  sweepCsvColumns,
  sweepToCsv,
  type SweepCell,
  type SweepSeries,
} from '@/lib/sim/sweep'
import { csvEscape } from '@/lib/library/paper-notes'
import type { Algorithm, SimMetrics } from '@/lib/sim/types'

const NODES = getSweepVarMeta('nodeCount')!
const QUEUE = getSweepVarMeta('queueCapacityPackets')!

describe('扫参的轴：取值点怎么取', () => {
  it('含端点（8→24 步长 4 得 5 个点）', () => {
    expect(buildSweepAxis(NODES, 8, 24, 4).values).toEqual([8, 12, 16, 20, 24])
  })

  it('终点没被步长整除时**补上终点**（否则用户填的 23 被静默丢掉）', () => {
    expect(buildSweepAxis(NODES, 8, 23, 4).values).toEqual([8, 12, 16, 20, 23])
  })

  it('步长必须为正、终点不能小于起点、范围要在元数据区间内', () => {
    expect(buildSweepAxis(NODES, 8, 24, 0).error).toMatch(/步长/)
    expect(buildSweepAxis(NODES, 24, 8, 4).error).toMatch(/终点不能小于起点/)
    expect(buildSweepAxis(NODES, 2, 24, 4).error).toMatch(/取值范围/)
    expect(buildSweepAxis(NODES, 8, 999, 4).error).toMatch(/取值范围/)
  })

  it('点数不足两点时明确报错（画不出趋势）', () => {
    expect(buildSweepAxis(NODES, 8, 8, 4).error).toMatch(/至少要有两个取值点/)
  })

  it('点数超过上限时报错并说清怎么改', () => {
    const r = buildSweepAxis(QUEUE, 4, 4 + 2 * (MAX_AXIS_POINTS + 4), 2)
    expect(r.values).toEqual([])
    expect(r.error).toMatch(new RegExp(`上限 ${MAX_AXIS_POINTS}`))
    expect(r.error).toMatch(/步长改大或范围缩小/)
  })

  it('非数字输入不会算出 NaN 轴', () => {
    expect(buildSweepAxis(NODES, Number.NaN, 24, 4).error).toMatch(/必须是数字/)
    expect(buildSweepAxis(NODES, 8, 24, Number.POSITIVE_INFINITY).error).toMatch(/必须是数字/)
  })
})

describe('扫参计划：预计跑多少次', () => {
  const base = {
    topology: 'ring' as const,
    sweepVar: 'nodeCount',
    from: 8,
    to: 24,
    step: 8,
    // 用可变的 Algorithm[]（而不是 as const 的字面量元组）：后者是 readonly，不能传给 SweepPlanInput
    algorithms: ['dijkstra', 'qlearning'] as Algorithm[],
    seedRuns: 3,
  }

  it('格数 = 轴点数 × 算法数，总运行数 = 格数 × 种子数', () => {
    const plan = buildSweepPlan({ ...base, algorithms: [...base.algorithms] })
    expect(plan.values).toEqual([8, 16, 24])
    expect(plan.cells).toBe(6)
    expect(plan.totalRuns).toBe(18)
    expect(plan.error).toBeUndefined()
  })

  it('总运行数超上限时拒绝，并把计划规模一并返回（便于界面提示怎么缩）', () => {
    // 12 个点（刚好在点数上限内）× 3 算法 × 5 种子 = 180 次 > 上限 120
    const plan = buildSweepPlan({
      topology: 'ring', sweepVar: 'queueCapacityPackets', from: 4, to: 48, step: 4,
      algorithms: ['dijkstra', 'loadaware', 'qlearning'], seedRuns: 5,
    })
    expect(plan.values).toHaveLength(MAX_AXIS_POINTS)
    expect(plan.cells).toBe(MAX_AXIS_POINTS * 3)
    expect(plan.totalRuns).toBeGreaterThan(MAX_TOTAL_RUNS)
    expect(plan.error).toMatch(new RegExp(`上限 ${MAX_TOTAL_RUNS}`))
    expect(plan.error).toMatch(/减少取值点/)
  })

  it('Spine-Leaf + 节点数轴 → 直接拒绝（该拓扑的规模由 spine/leaf 决定，不吃这个参数）', () => {
    const plan = buildSweepPlan({ ...base, topology: 'spineleaf', algorithms: [...base.algorithms] })
    expect(plan.error).toMatch(/Spine-Leaf/)
    expect(plan.error).toMatch(/换一个轴/)
  })

  it('未知轴 / 空算法列表都会报错', () => {
    expect(buildSweepPlan({ ...base, sweepVar: 'nothing' }).error).toMatch(/未知的参数轴/)
    expect(buildSweepPlan({ ...base, algorithms: [] }).error).toMatch(/至少选一种路由算法/)
  })

  it('种子数被夹紧到 1..10（防止有人填 999 把服务端占死）', () => {
    expect(buildSweepPlan({ ...base, algorithms: ['dijkstra'], from: 8, to: 12, step: 4, seedRuns: 999 }).seedRuns).toBe(10)
    expect(buildSweepPlan({ ...base, algorithms: ['dijkstra'], from: 8, to: 12, step: 4, seedRuns: 0 }).seedRuns).toBe(1)
  })

  it('只认已知算法（脏值被过滤掉，不会变成「跑了个不存在的算法」）', () => {
    const plan = buildSweepPlan({ ...base, algorithms: ['dijkstra', 'bogus'] as never })
    expect(plan.algorithms).toEqual(['dijkstra'])
  })

  it('每根轴都带元数据（界面直接用）', () => {
    for (const v of SWEEP_VARS) {
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.min).toBeLessThan(v.max)
      expect(v.defaultFrom).toBeLessThanOrEqual(v.defaultTo)
      expect(v.defaultStep).toBeGreaterThan(0)
    }
  })
})

describe('结果汇总：均值 / 标准差 / 失败计数', () => {
  const m = (delivery: number): SimMetrics => ({ deliveryRatePercent: delivery } as SimMetrics)

  it('按算法分组、按 x 排序，均值标准差用总体口径（与 lib/sim/index.ts 的 agg 一致）', () => {
    const cells: SweepCell[] = [
      { x: 16, algorithm: 'dijkstra', metrics: [m(90), m(80)], failures: 0 },
      { x: 8, algorithm: 'dijkstra', metrics: [m(100)], failures: 0 },
      { x: 8, algorithm: 'qlearning', metrics: [m(50)], failures: 1 },
    ]
    const s = summarizeSweep(cells, 'deliveryRatePercent')
    expect(s.map((x) => x.algorithm)).toEqual(['dijkstra', 'qlearning'])
    const d = s.find((x) => x.algorithm === 'dijkstra')!
    expect(d.points.map((p) => p.x)).toEqual([8, 16])
    expect(d.points[1]).toMatchObject({ mean: 85, std: 5, min: 80, max: 90, n: 2 })
    const q = s.find((x) => x.algorithm === 'qlearning')!
    expect(q.points[0]).toMatchObject({ mean: 50, n: 1, failures: 1 })
  })

  it('整格失败（没有样本）时 mean=0、n=0，但保留 failures 让人看得见', () => {
    const s = summarizeSweep([{ x: 8, algorithm: 'dijkstra', metrics: [], failures: 3, error: 'boom' }], 'deliveryRatePercent')
    expect(s[0].points[0]).toMatchObject({ mean: 0, std: 0, n: 0, failures: 3 })
  })

  it('aggregate 对空数组不返回 NaN', () => {
    expect(aggregate([])).toEqual({ mean: 0, std: 0, min: 0, max: 0, n: 0 })
  })
})

describe('CSV 导出', () => {
  const series: SweepSeries[] = [
    { algorithm: 'dijkstra', points: [{ x: 8, mean: 96.1, std: 0.5, min: 95, max: 97, n: 3, failures: 0 }] },
    { algorithm: 'qlearning', points: [{ x: 8, mean: 88, std: 2, min: 85, max: 91, n: 3, failures: 1 }] },
  ]

  it('带 BOM + CRLF，表头与列一致（Excel 双击不乱码的前提）', () => {
    const csv = sweepToCsv(series, 'deliveryRatePercent', '拓扑节点数（个）', csvEscape)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('\r\n')
    const [header, ...rows] = csv.replace('\uFEFF', '').split('\r\n')
    expect(header.split(',')).toEqual(sweepCsvColumns('deliveryRatePercent', '拓扑节点数（个）'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('dijkstra')
  })

  it('含逗号的字段被引号包住（表头里有中文括号+单位，但更典型的是算法名带逗号）', () => {
    const odd: SweepSeries[] = [{ algorithm: 'a,b' as never, points: [{ x: 1, mean: 1, std: 0, min: 1, max: 1, n: 1, failures: 0 }] }]
    const csv = sweepToCsv(odd, 'deliveryRatePercent', 'X', csvEscape)
    expect(csv).toContain('"a,b"')
  })

  it('每个指标都有可读标签（界面的指标选择器直接用）', () => {
    for (const m of SWEEP_METRICS) expect(m.label.length).toBeGreaterThan(0)
  })
})

describe('近 7 天运行记录：按天分桶', () => {
  const run = (
    date: Date,
    over: Partial<{ algorithm: string; status: string; delivery: number; label: string; metricsRaw: string }> = {},
  ) => ({
    createdAt: new Date(date),
    topology: 'ring',
    algorithm: over.algorithm ?? 'dijkstra',
    status: over.status ?? 'done',
    // 失败的行在真实落库时 metrics 是 '{}'（没有可统计的样本）—— 这里如实照做
    metrics: over.metricsRaw ?? (over.status === 'failed' ? '{}' : JSON.stringify({ deliveryRatePercent: over.delivery ?? 90 })),
    label: over.label ?? '',
  })

  it('含空白天：7 天窗口里没有运行的那天也要出现（否则「这周没跑实验」看不出来）', () => {
    const now = new Date(2026, 8, 22, 10, 0, 0) // 2026-09-22 本地时间
    const a = buildRecentActivity([run(new Date(2026, 8, 22, 9, 0, 0))], now, 7)
    expect(a.days).toHaveLength(7)
    expect(a.days.map((d) => d.date)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'])
    expect(a.days[6].count).toBe(1)
    expect(a.days[0].count).toBe(0)
    expect(a.days[0].deliveryMean).toBeNull()
  })

  it('窗口外的数据不计入（也不会崩）', () => {
    const now = new Date(2026, 8, 22, 10, 0, 0)
    const a = buildRecentActivity([run(new Date(2026, 8, 1, 9, 0, 0)), run(new Date(2026, 8, 22, 9, 0, 0))], now, 7)
    expect(a.totals.count).toBe(1)
  })

  it('统计失败数、扫描条数与算法/拓扑分布，交付率取当日均值', () => {
    const now = new Date(2026, 8, 22, 23, 0, 0)
    const a = buildRecentActivity(
      [
        run(new Date(2026, 8, 22, 9, 0, 0), { delivery: 90 }),
        run(new Date(2026, 8, 22, 10, 0, 0), { delivery: 80, algorithm: 'qlearning' }),
        run(new Date(2026, 8, 22, 11, 0, 0), { status: 'failed', label: '扫描：队列容量=16包 · dijkstra' }),
        run(new Date(2026, 8, 21, 9, 0, 0), { delivery: 100, label: '扫描：队列容量=32包 · dijkstra' }),
      ],
      now,
      7,
    )
    const today = a.days[6]
    expect(today).toMatchObject({ date: '2026-09-22', count: 3, ok: 2, failed: 1, sweeps: 1 })
    expect(today.byAlgorithm[0]).toEqual({ algorithm: 'dijkstra', count: 2 })
    expect(today.deliveryMean).toBe(85) // (90+80)/2：失败那条没有指标，不计入均值
    expect(a.totals).toMatchObject({ count: 4, ok: 3, failed: 1, sweeps: 2 })
    expect(a.busiest).toEqual({ date: '2026-09-22', count: 3 })
  })

  it('metrics 坏掉（不是 JSON / 缺字段）时跳过交付率，而不是让整天变成 NaN', () => {
    const now = new Date(2026, 8, 22, 12, 0, 0)
    const a = buildRecentActivity(
      [
        { createdAt: new Date(2026, 8, 22, 9, 0, 0), topology: 'ring', algorithm: 'dijkstra', status: 'done', metrics: '{坏 JSON', label: '' },
        { createdAt: new Date(2026, 8, 22, 9, 30, 0), topology: 'ring', algorithm: 'dijkstra', status: 'done', metrics: JSON.stringify({ deliveryRatePercent: 66 }), label: '' },
      ],
      now,
      7,
    )
    expect(a.days[6].count).toBe(2)
    expect(a.days[6].deliveryMean).toBe(66)
    expect(Number.isNaN(a.totals.deliveryMean as number)).toBe(false)
  })

  it('完全没有运行时不崩，最忙的一天为 null', () => {
    const a = buildRecentActivity([], new Date(2026, 8, 22, 12, 0, 0), 7)
    expect(a.totals.count).toBe(0)
    expect(a.totals.deliveryMean).toBeNull()
    expect(a.busiest).toBeNull()
  })

  it('日期键用本地时区（用 UTC 会把东八区凌晨的实验记到前一天）', () => {
    expect(localDateKey(new Date(2026, 8, 22, 0, 30, 0))).toBe('2026-09-22')
    expect(localDateKey(new Date(2026, 8, 22, 23, 30, 0))).toBe('2026-09-22')
  })

  it('窗口天数被夹紧到 1..30', () => {
    const now = new Date(2026, 8, 22, 12, 0, 0)
    expect(buildRecentActivity([], now, 0).days).toHaveLength(1)
    expect(buildRecentActivity([], now, 999).days).toHaveLength(30)
  })
})
