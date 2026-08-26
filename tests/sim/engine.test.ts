import { describe, expect, it } from 'vitest'
import { runExperiment } from '@/lib/sim'
import type { ExperimentParams } from '@/lib/sim/types'

const base: ExperimentParams = {
  topology: 'ring',
  algorithm: 'dijkstra',
  seed: 42,
  runs: 1,
}

/** 排除天然不确定字段（耗时计量）后的确定性快照 */
function snapshot(params: ExperimentParams): string {
  const r = JSON.parse(JSON.stringify(runSingle0(params))) as Record<string, unknown>
  delete (r as { durationMs?: number }).durationMs
  return JSON.stringify(r)
}
function runSingle0(params: ExperimentParams) {
  return runExperiment({ ...params, runs: 1 })
}

describe('engine：离散事件仿真内核', () => {
  it('【可复现承诺】同参数两次运行 ⇒ 完整结果字节级一致（跨算法×拓扑×队列策略）', () => {
    const cases: ExperimentParams[] = [
      base,
      { ...base, topology: 'mesh', algorithm: 'loadaware' },
      { ...base, topology: 'spineleaf', algorithm: 'qlearning', spineCount: 4, leafCount: 8 },
      { ...base, discipline: 'red' },
      { ...base, scheduler: 'priority', failureAtMs: 500 },
    ]
    for (const params of cases) {
      expect(snapshot(params)).toBe(snapshot(params))
    }
  })

  it('不同种子 ⇒ 结果不同（种子确实参与了实验）', () => {
    const a = JSON.stringify(runSingle0(base))
    const b = JSON.stringify(runSingle0({ ...base, seed: 43 }))
    expect(a).not.toBe(b)
  })

  it('预热包被剔除：三流各 20 包 warmup 3 ⇒ 统计 sent = 51', () => {
    const m = runSingle0(base).runs[0].metrics
    expect(m.sent).toBe(51)
    expect(m.delivered + m.dropped).toBe(m.sent)
  })

  it('【拥塞物理】队列容量 64 相比默认 8 显著提升交付率（丢包来自拥塞而非缺陷）', () => {
    const tight = runSingle0({ ...base, seed: 1 }).runs[0].metrics
    const loose = runSingle0({ ...base, seed: 1, queueCapacityPackets: 64 }).runs[0].metrics
    expect(loose.deliveryRatePercent).toBeGreaterThan(tight.deliveryRatePercent + 20)
    expect(loose.droppedByReason['queue-full']).toBeLessThan(tight.droppedByReason['queue-full'])
  })

  it('【故障收敛】注入链路故障后 convergenceTimeMs 非空且为正', () => {
    const m = runSingle0({ ...base, seed: 7, failureAtMs: 500, detectionDelayMs: 40 }).runs[0].metrics
    expect(m.convergenceTimeMs).not.toBeNull()
    expect(m.convergenceTimeMs!).toBeGreaterThan(0)
  })

  it('指标体系形状完整：分位数有序、Jain 指数 ∈ [0,1]、丢包原因分解齐全', () => {
    const m = runSingle0({ ...base }).runs[0].metrics
    expect(m.latencyP50Ms).toBeLessThanOrEqual(m.latencyP95Ms)
    expect(m.latencyP95Ms).toBeLessThanOrEqual(m.latencyP99Ms)
    expect(m.jainFairnessIndex).toBeGreaterThan(0)
    expect(m.jainFairnessIndex).toBeLessThanOrEqual(1)
    expect(Object.keys(m.droppedByReason).sort()).toEqual(
      ['congestion', 'link-failure', 'link-loss', 'no-route', 'queue-full', 'red-early-drop'].sort()
    )
    expect(m.flowMetrics).toHaveLength(3)
  })

  it('RED 与优先级调度路径可运行且产出合法指标', () => {
    const red = runSingle0({ ...base, discipline: 'red' }).runs[0].metrics
    const prio = runSingle0({ ...base, scheduler: 'priority' }).runs[0].metrics
    for (const m of [red, prio]) {
      expect(m.sent).toBe(51)
      expect(m.deliveryRatePercent).toBeGreaterThanOrEqual(0)
      expect(m.deliveryRatePercent).toBeLessThanOrEqual(100)
    }
  })

  it('Q-Learning 全流程：训练报告随结果返回，greedyPath 可达', () => {
    const r = runSingle0({
      ...base,
      algorithm: 'qlearning',
      spineCount: 4,
      leafCount: 8,
      topology: 'spineleaf',
    }).runs[0]
    expect(r.training).toBeDefined()
    expect(r.training!.episodes).toBe(300)
    expect(r.training!.foundPath).toBe(true)
    expect(r.metrics.flowMetrics[0].pathHops).toBeGreaterThan(0)
  })

  it('多种子批量：runs=5 ⇒ 5 个独立种子结果 + 聚合统计', () => {
    const batch = runExperiment({ ...base, runs: 5 })
    expect(batch.runs).toHaveLength(5)
    const seeds = new Set(batch.runs.map((r) => r.seed))
    expect(seeds.size).toBe(5)
    expect(batch.aggregate).toBeDefined()
    expect(batch.aggregate!.deliveryRatePercent.mean).toBeGreaterThanOrEqual(0)
    // std 为总体标准差：全同值时为 0
    expect(batch.topologySummary.topology).toBe('ring')
  })
})
