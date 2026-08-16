/**
 * 实验入口 —— 批量多种子运行 + 关键指标汇总（均值/标准差/极值）。
 */

import { runSingle } from './engine'
import { buildTopology, TOPOLOGY_META } from './topology'
import type { AggStat, BatchResult, ExperimentParams, SingleRunResult } from './types'

export { TOPOLOGY_META }

function agg(values: number[]): AggStat {
  if (values.length === 0) return { mean: 0, std: 0, min: 0, max: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return {
    mean: round2(mean),
    std: round2(Math.sqrt(variance)),
    min: round2(Math.min(...values)),
    max: round2(Math.max(...values)),
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100

export function runExperiment(params: ExperimentParams): BatchResult {
  const start = Date.now()
  const runs = Math.min(20, Math.max(1, params.runs ?? 1))
  const results: SingleRunResult[] = []
  for (let i = 0; i < runs; i++) {
    results.push(runSingle(params, params.seed + i))
  }
  const topo = buildTopology(params.topology, {
    seed: params.seed,
    nodeCount: params.nodeCount,
    spineCount: params.spineCount,
    leafCount: params.leafCount,
  })
  const batch: BatchResult = {
    params: { ...params, runs },
    runs: results,
    topologySummary: { nodeCount: topo.nodes.length, edgeCount: topo.edges.length, topology: params.topology },
    durationMs: Date.now() - start,
  }
  if (runs > 1) {
    batch.aggregate = {
      deliveryRatePercent: agg(results.map((r) => r.metrics.deliveryRatePercent)),
      throughputPacketsPerSecond: agg(results.map((r) => r.metrics.throughputPacketsPerSecond)),
      latencyP95Ms: agg(results.map((r) => r.metrics.latencyP95Ms)),
      jitterMs: agg(results.map((r) => r.metrics.jitterMs)),
      jainFairnessIndex: agg(results.map((r) => r.metrics.jainFairnessIndex)),
      linkLoadJainIndex: agg(results.map((r) => r.metrics.linkLoadJainIndex)),
    }
  }
  return batch
}
