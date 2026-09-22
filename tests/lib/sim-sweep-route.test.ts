import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

/**
 * 参数扫描与「近 7 天运行记录」的接口契约。
 *
 * 这里必须真调 handler，因为三类错误都不会被类型/单测抓到：
 *  ① 规模失控：一个请求跑几百次仿真会把服务端占住几分钟（必须 400 拒绝）；
 *  ② 单格失败中断整批：某一格引擎抛错，结果应该「半张图 + 明确失败标记」，而不是整批 500；
 *  ③ 落库条数与格数不一致：界面上看是「跑完了」，但历史里少了几行 —— 静默的数据丢失。
 */

const dbMock = vi.hoisted(() => {
  const make = () => ({
    findMany: vi.fn(async () => [] as unknown[]),
    findUnique: vi.fn(async () => null as unknown),
    count: vi.fn(async () => 0),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: `run-${Math.random().toString(36).slice(2, 8)}`, ...args.data })),
    update: vi.fn(),
    delete: vi.fn(),
  })
  type Model = ReturnType<typeof make>
  const models: Record<string, Model> = {}
  const get = (key: string): Model => {
    if (!models[key]) models[key] = make()
    return models[key]
  }
  return { get, db: new Proxy({} as Record<string, Model>, { get: (_t, p) => get(String(p)) }) }
})

vi.mock('@/lib/db', () => ({ db: dbMock.db }))

vi.mock('@/lib/sim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sim')>()
  return { ...actual, runExperiment: vi.fn() }
})

import { runExperiment } from '@/lib/sim'

type Batch = ReturnType<typeof runExperiment>

function batchOf(delivery: number, seed: number, runs = 1): Batch {
  return {
    params: { topology: 'ring', algorithm: 'dijkstra', seed } as never,
    runs: Array.from({ length: runs }, (_, i) => ({
      seed: seed + i,
      metrics: { deliveryRatePercent: delivery, throughputPacketsPerSecond: 100, latencyP95Ms: 5, jitterMs: 1 },
    })) as never,
    topologySummary: { nodeCount: 8, edgeCount: 9, topology: 'ring' } as never,
    durationMs: 1,
  } as unknown as Batch
}

function post(body: unknown, url = 'http://localhost/api/sim/sweep') {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.mocked(runExperiment).mockReset()
  vi.mocked(runExperiment).mockImplementation((p) => batchOf(90, p.seed ?? 1, p.runs ?? 1))
  for (const name of ['simRun']) {
    const m = dbMock.get(name)
    m.create.mockClear()
    m.findMany.mockClear()
    m.findMany.mockResolvedValue([])
  }
})

const PLAN = { topology: 'ring', sweepVar: 'nodeCount', from: 8, to: 16, step: 8, algorithms: ['dijkstra', 'qlearning'], seedRuns: 2 }

describe('POST /api/sim/sweep', () => {
  it('正常扫描：格数 = 轴点 × 算法，且**每格都落库**', async () => {
    const { POST } = await import('@/app/api/sim/sweep/route')
    const res = await POST(post(PLAN))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.axis.values).toEqual([8, 16])
    expect(body.cells).toBe(4)
    expect(body.totalRuns).toBe(8) // 2 点 × 2 算法 × 2 种子
    expect(body.failures).toBe(0)
    expect(body.runIds).toHaveLength(4)
    expect(dbMock.get('simRun').create).toHaveBeenCalledTimes(4)
    // 两条线（两个算法），每条两个点
    expect(body.series.map((s: { algorithm: string }) => s.algorithm)).toEqual(['dijkstra', 'qlearning'])
    for (const s of body.series) expect(s.points).toHaveLength(2)
    // 被扫的轴确实覆盖进了引擎参数
    const calls = vi.mocked(runExperiment).mock.calls.map((c) => c[0])
    expect(calls.map((c) => c.nodeCount)).toEqual([8, 8, 16, 16])
    expect(calls.every((c) => c.runs === 2)).toBe(true)
  })

  it('落库时带上「扫描」前缀与复现参数（历史与近 7 天都靠它识别）', async () => {
    const { POST } = await import('@/app/api/sim/sweep/route')
    await POST(post(PLAN))
    const first = dbMock.get('simRun').create.mock.calls[0][0].data
    expect(String(first.label)).toMatch(/^扫描：/)
    expect(first.status).toBe('done')
    const params = JSON.parse(String(first.params))
    expect(params.sweep).toMatchObject({ var: 'nodeCount', value: 8 })
    expect(params.runs).toBe(2)
    // metrics 是多种子均值，近 7 天聚合要能解析出交付率
    expect(JSON.parse(String(first.metrics)).deliveryRatePercent).toBe(90)
  })

  it('规模超限直接 400，且**不跑仿真、不落库**', async () => {
    const { POST } = await import('@/app/api/sim/sweep/route')
    // 轴换成队列容量（4~512），12 点 × 3 算法 × 5 种子 = 180 次 > 上限 120
    const res = await POST(
      post({ ...PLAN, sweepVar: 'queueCapacityPackets', from: 4, to: 48, step: 4, algorithms: ['dijkstra', 'loadaware', 'qlearning'], seedRuns: 5 }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/上限/)
    expect(runExperiment).not.toHaveBeenCalled()
    expect(dbMock.get('simRun').create).not.toHaveBeenCalled()
  })

  it('取值范围越界也直接 400（不必等到跑起来才发现）', async () => {
    const { POST } = await import('@/app/api/sim/sweep/route')
    const res = await POST(post({ ...PLAN, from: 4 })) // nodeCount 的下限是 6
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/取值范围/)
    expect(runExperiment).not.toHaveBeenCalled()
  })

  it('Spine-Leaf + 节点数轴 → 400（该拓扑不吃这个参数）', async () => {
    const { POST } = await import('@/app/api/sim/sweep/route')
    const res = await POST(post({ ...PLAN, topology: 'spineleaf' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Spine-Leaf/)
    expect(runExperiment).not.toHaveBeenCalled()
  })

  it('某一格引擎失败：其余照常跑完，失败数如实报出并落一条 failed 记录', async () => {
    let call = 0
    vi.mocked(runExperiment).mockImplementation((p) => {
      call += 1
      if (call === 2) throw new Error('拓扑构建失败：nodeCount 不合法')
      return batchOf(88, p.seed ?? 1, p.runs ?? 1)
    })
    const { POST } = await import('@/app/api/sim/sweep/route')
    const res = await POST(post(PLAN))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cells).toBe(4)
    expect(body.failures).toBe(1)
    expect(body.runIds).toHaveLength(4) // 失败的那格也要有记录，用户才知道「这格没跑成」
    const rows = dbMock.get('simRun').create.mock.calls.map((c) => c[0].data)
    const failedRow = rows.find((r) => r.status === 'failed')!
    expect(String(failedRow.error)).toMatch(/拓扑构建失败/)
    expect(JSON.parse(String(failedRow.metrics))).toEqual({}) // 没有样本就不编造指标
  })
})

describe('POST /api/sim/sweep/export', () => {
  const series = [{ algorithm: 'dijkstra', points: [{ x: 8, mean: 96.1, std: 0.5, min: 95, max: 97, n: 3, failures: 0 }] }]

  it('空结果 → 400', async () => {
    const { POST } = await import('@/app/api/sim/sweep/export/route')
    expect((await POST(post({ series: [] }, 'http://localhost/api/sim/sweep/export'))).status).toBe(400)
  })

  it('正常导出：附件式 CSV，**文件字节带 BOM** 且文件名是中文', async () => {
    const { POST } = await import('@/app/api/sim/sweep/export/route')
    const res = await POST(post({ series, metric: 'deliveryRatePercent', xLabel: '拓扑节点数（个）' }, 'http://localhost/api/sim/sweep/export'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    expect(decodeURIComponent(res.headers.get('content-disposition') || '')).toMatch(/参数扫描/)

    // ⚠️ 这里必须断**字节**而不是断字符串：`Response.text()` 按 fetch 规范会剥掉开头的 BOM，
    //    而 Excel 认的正是那三个字节（EF BB BF）。断字符串会得到「测试说没有 BOM、其实有」的假结论。
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])

    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('交付率(均值)')
    expect(text).toContain('dijkstra')
  })
})

describe('GET /api/sim/runs/recent', () => {
  it('返回 7 天分桶结构（含空白天）', async () => {
    dbMock.get('simRun').findMany.mockResolvedValue([
      { createdAt: new Date(), topology: 'ring', algorithm: 'dijkstra', status: 'done', metrics: JSON.stringify({ deliveryRatePercent: 92 }), label: '' },
      { createdAt: new Date(), topology: 'mesh', algorithm: 'qlearning', status: 'failed', metrics: '{}', label: '扫描：队列容量=16包 · qlearning' },
    ])
    const { GET } = await import('@/app/api/sim/runs/recent/route')
    const body = await (await GET(new NextRequest('http://localhost/api/sim/runs/recent?days=7'))).json()
    expect(body.days).toHaveLength(7)
    expect(body.totals).toMatchObject({ count: 2, ok: 1, failed: 1, sweeps: 1 })
    const today = body.days[6]
    expect(today.count).toBe(2)
    expect(today.deliveryMean).toBe(92)
  })

  it('days 参数被夹紧（避免传个 9999 把库扫一遍）', async () => {
    const { GET } = await import('@/app/api/sim/runs/recent/route')
    const body = await (await GET(new NextRequest('http://localhost/api/sim/runs/recent?days=9999'))).json()
    expect(body.days).toHaveLength(30)
  })
})

describe('界面接线（源码级）', () => {
  const panel = readFileSync(path.join(process.cwd(), 'src', 'components', 'sim-sweep-panel.tsx'), 'utf8')
  const section = readFileSync(path.join(process.cwd(), 'src', 'components', 'sections', 'sim-lab-section.tsx'), 'utf8')

  it('面板调用了扫描与导出接口', () => {
    expect(panel).toMatch(/\/api\/sim\/sweep\b/)
    expect(panel).toMatch(/\/api\/sim\/sweep\/export/)
    // 「近 7 天使用记录」已改成跨模块面板，放在概览页（守卫在 tests/lib/activity.test.ts）
  })

  it('面板标题能被用户看到', () => {
    expect(panel).toMatch(/参数扫描/)
  })

  it('仿真页挂上了扫描面板，并在跑完实验后刷新实验历史', () => {
    expect(section).toMatch(/<SimSweepPanel/)
    // 单次运行 / 三算法对比 / 删除记录 之后都要刷新历史列表
    expect((section.match(/loadHistory\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('导出走服务端附件下载（前端 Blob 在桌面端会落不到文件）', () => {
    expect(panel).toMatch(/downloadViaPost/)
  })

  it('跑之前先把规模算清楚（纯函数预览，不在点下去之后才报错）', () => {
    expect(panel).toMatch(/buildSweepPlan/)
    expect(panel).toMatch(/预计 .* 次仿真/)
  })
})
