/**
 * `ExperimentParams` 的**唯一**解析口。
 *
 * 抽出来的原因很实际：`/api/sim/run` 里那 20 行「逐字段判类型 + 兜默认值」的代码，
 * 只要第二条路由（参数扫描）也照抄一份，两边的默认值迟早会漂 ——
 * 那时「同一个参数、两条入口、结果不一样」会变成一个很难查的问题
 * （本项目刚在阅读优先级公式上吃过一次同样的亏：三处复制，改一处忘一处）。
 */

import type { Algorithm, ExperimentParams, TopologyId } from './types'

const TOPOLOGIES: readonly string[] = ['ring', 'spineleaf', 'mesh']
const ALGORITHMS: readonly string[] = ['dijkstra', 'loadaware', 'qlearning']

export function parseExperimentParams(body: Record<string, unknown>): ExperimentParams {
  return {
    topology: (TOPOLOGIES.includes(String(body.topology)) ? body.topology : 'ring') as TopologyId,
    algorithm: (ALGORITHMS.includes(String(body.algorithm)) ? body.algorithm : 'dijkstra') as Algorithm,
    seed: Number.isFinite(body.seed) ? Math.floor(Number(body.seed)) : 20260727,
    runs: Number.isFinite(body.runs) ? Math.min(20, Math.max(1, Math.floor(Number(body.runs)))) : 1,
    nodeCount: Number.isFinite(body.nodeCount) ? Number(body.nodeCount) : undefined,
    spineCount: Number.isFinite(body.spineCount) ? Number(body.spineCount) : undefined,
    leafCount: Number.isFinite(body.leafCount) ? Number(body.leafCount) : undefined,
    source: typeof body.source === 'string' && body.source ? body.source : undefined,
    destination: typeof body.destination === 'string' && body.destination ? body.destination : undefined,
    queueCapacityPackets: Number.isFinite(body.queueCapacityPackets) ? Number(body.queueCapacityPackets) : undefined,
    scheduler: body.scheduler === 'priority' ? 'priority' : 'fifo',
    discipline: body.discipline === 'red' ? 'red' : 'droptail',
    red: body.red && typeof body.red === 'object' ? (body.red as ExperimentParams['red']) : undefined,
    failureAtMs: Number.isFinite(body.failureAtMs) ? Number(body.failureAtMs) : 0,
    detectionDelayMs: Number.isFinite(body.detectionDelayMs) ? Number(body.detectionDelayMs) : 40,
    qlearning: body.qlearning && typeof body.qlearning === 'object' ? (body.qlearning as ExperimentParams['qlearning']) : undefined,
  }
}

export function isAlgorithm(v: unknown): v is Algorithm {
  return typeof v === 'string' && ALGORITHMS.includes(v)
}
