/**
 * 参数扫描（扫参）与「近 7 天运行记录」的纯逻辑层。
 *
 * 为什么要扫参：科研里真正要的是「曲线」—— 交付率随节点数怎么变、队列容量加到多少就饱和。
 * 现状只能手点 N 次「运行实验」再把数字抄出来，既慢又容易抄错，而引擎本身是**确定性的**
 * （种子化 + FNV-1a 派生），天生适合批量跑。
 *
 * 这里只放可单测的纯函数：轴怎么取、预计跑多少次、结果怎么汇总、CSV 怎么序列化、
 * 近 7 天怎么分桶。真正调引擎与落库在路由里。
 */

import type { Algorithm, ExperimentParams, SimMetrics, TopologyId } from './types'

/** 可扫的参数轴 —— 只用 `ExperimentParams` 里真实存在、且对结果有单调影响意图的旋钮 */
export type SweepVar = 'nodeCount' | 'queueCapacityPackets' | 'failureAtMs' | 'detectionDelayMs'

export interface SweepVarMeta {
  id: SweepVar
  label: string
  unit: string
  min: number
  max: number
  defaultFrom: number
  defaultTo: number
  defaultStep: number
  /** 该轴不适用的拓扑（例如 Spine-Leaf 的规模由 spine/leaf 数决定，不吃 nodeCount） */
  exceptTopology?: TopologyId[]
  hint: string
}

export const SWEEP_VARS: readonly SweepVarMeta[] = [
  {
    id: 'nodeCount',
    label: '拓扑节点数',
    unit: '个',
    min: 6,
    max: 64,
    defaultFrom: 8,
    defaultTo: 24,
    defaultStep: 4,
    exceptTopology: ['spineleaf'],
    hint: '环形 / Mesh 的规模轴。Spine-Leaf 由 spine/leaf 数决定，不吃这个轴。',
  },
  {
    id: 'queueCapacityPackets',
    label: '队列容量',
    unit: '包',
    min: 4,
    max: 512,
    defaultFrom: 16,
    defaultTo: 128,
    defaultStep: 16,
    hint: '缓冲深度轴：容量小易丢包、大到一定程度后交付率饱和 —— 最常见的「拐点」图。',
  },
  {
    id: 'failureAtMs',
    label: '链路故障注入时刻',
    unit: 'ms',
    min: 0,
    max: 5000,
    defaultFrom: 0,
    defaultTo: 800,
    defaultStep: 200,
    hint: '0 表示不注入故障。配合「检测时延」可看收敛速度。',
  },
  {
    id: 'detectionDelayMs',
    label: '故障检测时延',
    unit: 'ms',
    min: 0,
    max: 2000,
    defaultFrom: 0,
    defaultTo: 400,
    defaultStep: 100,
    hint: '故障发生到重新选路之间的等待时间：越短越好，但过短会误判。',
  },
] as const

/** 一次扫描最多几个点、最多跑多少次 —— 超了就报错，别让一个请求把服务端占住 */
export const MAX_AXIS_POINTS = 12
export const MAX_TOTAL_RUNS = 120

export function getSweepVarMeta(id: string): SweepVarMeta | null {
  return SWEEP_VARS.find((v) => v.id === id) ?? null
}

export interface SweepAxis {
  values: number[]
  /** 生成过程中的问题（空数组=正常） */
  error?: string
}

/**
 * 生成轴上的取值：**含端点**（科研图习惯：from 与 to 都在图上），步长必须为正。
 *
 * 取整策略按轴不同：节点数/包数/时延都是整数语义，统一用整数步进；
 * 用 `Math.round` 避免浮点误差把 24 算成 23.999999。
 */
export function buildSweepAxis(
  meta: SweepVarMeta,
  from: number,
  to: number,
  step: number,
): SweepAxis {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step)) {
    return { values: [], error: '起点 / 终点 / 步长必须是数字' }
  }
  if (step <= 0) return { values: [], error: '步长必须大于 0' }
  if (to < from) return { values: [], error: '终点不能小于起点' }
  if (from < meta.min || to > meta.max) {
    return { values: [], error: `取值范围需在 ${meta.min} ~ ${meta.max} ${meta.unit} 之内` }
  }

  const values: number[] = []
  const n = Math.floor((to - from) / step)
  for (let i = 0; i <= n; i += 1) values.push(Math.round(from + i * step))
  // 端点没被步长整除时补上终点：否则用户填 8→23 步长 4 会「静默丢掉 23」
  if (values.length > 0 && values[values.length - 1] !== Math.round(to)) values.push(Math.round(to))

  if (values.length < 2) return { values, error: '至少要有两个取值点，否则画不出趋势（把步长改小或范围拉大）' }
  if (values.length > MAX_AXIS_POINTS) {
    return { values: [], error: `取值点 ${values.length} 个，超过上限 ${MAX_AXIS_POINTS}（把步长改大或范围缩小）` }
  }
  return { values }
}

export interface SweepPlanInput {
  topology: TopologyId
  sweepVar: string
  from: number
  to: number
  step: number
  algorithms: Algorithm[]
  /** 每个取值点跑几个种子（1 = 只跑一个种子，>1 = 输出均值±标准差） */
  seedRuns: number
}

export interface SweepPlan {
  meta: SweepVarMeta
  values: number[]
  algorithms: Algorithm[]
  seedRuns: number
  /** 轴点数 × 算法数 */
  cells: number
  /** cells × seedRuns —— 引擎实际要跑的仿真次数 */
  totalRuns: number
  error?: string
}

const ALGORITHMS: readonly Algorithm[] = ['dijkstra', 'loadaware', 'qlearning']

export function buildSweepPlan(input: SweepPlanInput): SweepPlan {
  const meta = getSweepVarMeta(input.sweepVar)
  const seedRuns = Math.min(10, Math.max(1, Math.round(input.seedRuns || 1)))
  const algorithms = input.algorithms.filter((a) => (ALGORITHMS as readonly string[]).includes(a))
  const base: SweepPlan = {
    meta: meta ?? SWEEP_VARS[0],
    values: [],
    algorithms,
    seedRuns,
    cells: 0,
    totalRuns: 0,
  }
  if (!meta) return { ...base, error: `未知的参数轴：${input.sweepVar}` }
  if (algorithms.length === 0) return { ...base, error: '至少选一种路由算法' }
  if (meta.exceptTopology && meta.exceptTopology.includes(input.topology)) {
    return {
      ...base,
      error: `${input.topology === 'spineleaf' ? 'Spine-Leaf' : input.topology} 拓扑下「${meta.label}」不是有效参数：Spine-Leaf 的规模由 spine / leaf 数决定。请换一个轴（队列容量 / 故障注入）或换拓扑。`,
    }
  }

  const axis = buildSweepAxis(meta, input.from, input.to, input.step)
  if (axis.error) return { ...base, values: axis.values, error: axis.error }

  const cells = axis.values.length * algorithms.length
  const totalRuns = cells * seedRuns
  if (totalRuns > MAX_TOTAL_RUNS) {
    return {
      ...base,
      values: axis.values,
      cells,
      totalRuns,
      error: `预计要跑 ${totalRuns} 次仿真（${axis.values.length} 点 × ${algorithms.length} 算法 × ${seedRuns} 种子），超过上限 ${MAX_TOTAL_RUNS}。请减少取值点 / 算法数 / 种子数。`,
    }
  }
  return { ...base, values: axis.values, cells, totalRuns }
}

// ---------------- 结果汇总 ----------------

/** 与 `lib/sim/index.ts` 的 agg 口径一致（均值/标准差/极值），这里独立实现以便单测 */
export interface Agg {
  mean: number
  std: number
  min: number
  max: number
  /** 参与统计的样本数（失败的种子不计入） */
  n: number
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

export function aggregate(values: number[]): Agg {
  if (values.length === 0) return { mean: 0, std: 0, min: 0, max: 0, n: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return { mean: round2(mean), std: round2(Math.sqrt(variance)), min: round2(Math.min(...values)), max: round2(Math.max(...values)), n: values.length }
}

/** 扫描要看的指标（前四个是主指标，后面当附注） */
export type SweepMetric = 'deliveryRatePercent' | 'throughputPacketsPerSecond' | 'latencyP95Ms' | 'jitterMs' | 'jainFairnessIndex' | 'linkLoadJainIndex'

export const SWEEP_METRICS: readonly { id: SweepMetric; label: string; unit: string; hint?: string }[] = [
  { id: 'deliveryRatePercent', label: '交付率', unit: '%' },
  { id: 'throughputPacketsPerSecond', label: '吞吐', unit: '包/秒' },
  { id: 'latencyP95Ms', label: 'P95 时延', unit: 'ms' },
  { id: 'jitterMs', label: '抖动', unit: 'ms' },
  { id: 'jainFairnessIndex', label: 'Jain 公平指数', unit: '', hint: '越接近 1 越公平' },
  { id: 'linkLoadJainIndex', label: '链路负载均衡指数', unit: '', hint: '越接近 1 越均衡' },
]

/** 一个取值点 × 一种算法的结果（由路由逐格跑出来后塞进来） */
export interface SweepCell {
  x: number
  algorithm: Algorithm
  /** 每个种子的指标（失败的不计入） */
  metrics: SimMetrics[]
  /** 失败种子数 */
  failures: number
  error?: string
}

export interface SweepSeries {
  algorithm: Algorithm
  points: Array<{
    x: number
    mean: number
    std: number
    min: number
    max: number
    n: number
    failures: number
  }>
}

/** 把逐格结果按算法分组成「一条线」 */
export function summarizeSweep(cells: SweepCell[], metric: SweepMetric): SweepSeries[] {
  const byAlgo = new Map<Algorithm, SweepCell[]>()
  for (const c of cells) {
    const list = byAlgo.get(c.algorithm) ?? []
    list.push(c)
    byAlgo.set(c.algorithm, list)
  }
  const out: SweepSeries[] = []
  for (const [algorithm, list] of byAlgo) {
    const points = list
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((c) => {
        const values = c.metrics
          .map((m) => Number(m[metric]))
          .filter((v) => Number.isFinite(v))
        const a = aggregate(values)
        return { x: c.x, mean: a.mean, std: a.std, min: a.min, max: a.max, n: a.n, failures: c.failures }
      })
    out.push({ algorithm, points })
  }
  return out.sort((a, b) => a.algorithm.localeCompare(b.algorithm))
}

/** 导出用的表头（与 CSV 列一致，界面上也直接复用） */
export function sweepCsvColumns(metric: SweepMetric, xLabel: string): string[] {
  return [xLabel, '算法', `${SWEEP_METRICS.find((m) => m.id === metric)?.label ?? metric}(均值)`, '标准差', '最小', '最大', '样本数', '失败数']
}

/**
 * 扫描结果的 CSV。
 * 转义规则沿用 `lib/library/paper-notes.ts` 的 `csvEscape`（引号/逗号/换行的处理只维护一份），
 * 带 UTF-8 BOM + CRLF —— 这两条是 Excel 直接双击打开中文不乱码的前提。
 */
export function sweepToCsv(series: SweepSeries[], metric: SweepMetric, xLabel: string, escape: (v: unknown) => string): string {
  const header = sweepCsvColumns(metric, xLabel)
  const lines = [header.join(',')]
  for (const s of series) {
    for (const p of s.points) {
      lines.push([p.x, s.algorithm, p.mean, p.std, p.min, p.max, p.n, p.failures].map(escape).join(','))
    }
  }
  return `\uFEFF${lines.join('\r\n')}`
}

// ---------------- 近 7 天运行记录 ----------------

export interface RecentRunLike {
  createdAt: Date | string
  topology: string
  algorithm: string
  status: string
  /** SimRun.metrics 的 JSON 字符串 */
  metrics?: string
  /** SimRun.label —— 扫描落的行带「扫描」前缀，单独计数更直观 */
  label?: string
}

export interface RecentDay {
  /** YYYY-MM-DD（本地时区） */
  date: string
  /** 该日运行总次数 */
  count: number
  ok: number
  failed: number
  /** 该日作为「扫描」落库的条数 */
  sweeps: number
  /** 按算法出现次数（降序，最多 3 项） */
  byAlgorithm: Array<{ algorithm: string; count: number }>
  byTopology: Array<{ topology: string; count: number }>
  /** 该日交付率均值（只有能解析出数值的才算） */
  deliveryMean: number | null
}

export interface RecentActivity {
  days: RecentDay[]
  totals: { count: number; ok: number; failed: number; sweeps: number; deliveryMean: number | null }
  busiest: { date: string; count: number } | null
}

/** 本地时区的 YYYY-MM-DD —— 用 UTC 会在东八区把「凌晨跑的实验」记到前一天 */
export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDelivery(raw?: string): number | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const v = Number(obj.deliveryRatePercent)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/**
 * 把最近 `days` 天的运行按**天**聚合（含没有运行的空白天 —— 空白也要出现在图里，
 * 否则「这周没跑实验」这件事在图上会看不出来）。
 *
 * @param now 注入当前时间，便于单测（不要在内部读 `new Date()`）
 */
export function buildRecentActivity(runs: RecentRunLike[], now: Date, days = 7): RecentActivity {
  const span = Math.max(1, Math.min(30, Math.round(days)))
  const buckets = new Map<string, { runs: RecentRunLike[] }>()
  const order: string[] = []
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = localDateKey(d)
    buckets.set(key, { runs: [] })
    order.push(key)
  }
  let outside = 0
  for (const r of runs) {
    const d = r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt))
    if (Number.isNaN(d.getTime())) continue
    const key = localDateKey(d)
    const b = buckets.get(key)
    if (!b) {
      outside += 1
      continue
    }
    b.runs.push(r)
  }

  const dayList: RecentDay[] = order.map((date) => {
    const list = buckets.get(date)!.runs
    const algoCount = new Map<string, number>()
    const topoCount = new Map<string, number>()
    const deliveries: number[] = []
    let ok = 0
    let failed = 0
    let sweeps = 0
    for (const r of list) {
      if (r.status === 'failed') failed += 1
      else ok += 1
      if ((r.label || '').startsWith('扫描')) sweeps += 1
      algoCount.set(r.algorithm, (algoCount.get(r.algorithm) ?? 0) + 1)
      topoCount.set(r.topology, (topoCount.get(r.topology) ?? 0) + 1)
      const d = parseDelivery(r.metrics)
      if (d !== null) deliveries.push(d)
    }
    const toTop = (m: Map<string, number>, take = 3) =>
      [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count).slice(0, take)
    return {
      date,
      count: list.length,
      ok,
      failed,
      sweeps,
      byAlgorithm: toTop(algoCount).map(({ key, count }) => ({ algorithm: key, count })),
      byTopology: toTop(topoCount).map(({ key, count }) => ({ topology: key, count })),
      deliveryMean: deliveries.length ? round2(deliveries.reduce((a, b) => a + b, 0) / deliveries.length) : null,
    }
  })

  const allDeliveries = dayList.map((d) => d.deliveryMean).filter((v): v is number => v !== null)
  const totals = {
    count: dayList.reduce((a, d) => a + d.count, 0),
    ok: dayList.reduce((a, d) => a + d.ok, 0),
    failed: dayList.reduce((a, d) => a + d.failed, 0),
    sweeps: dayList.reduce((a, d) => a + d.sweeps, 0),
    deliveryMean: allDeliveries.length ? round2(allDeliveries.reduce((a, b) => a + b, 0) / allDeliveries.length) : null,
  }
  const busiest = dayList.reduce<{ date: string; count: number } | null>(
    (best, d) => (d.count > 0 && (!best || d.count > best.count) ? { date: d.date, count: d.count } : best),
    null,
  )
  // outside>0 说明传进来的数据里有窗口外的行（路由已经按时间筛过，出现即说明筛选没生效）——
  // 不报错，但计数信息对排查有用，挂在 totals 上会污染结构，因此只在这里显式丢弃。
  void outside
  return { days: dayList, totals, busiest }
}
