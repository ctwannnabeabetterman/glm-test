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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function bounded(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined
}

function integer(value: unknown, min: number, max: number): number | undefined {
  const n = bounded(value, min, max)
  return n === undefined ? undefined : Math.floor(n)
}

export function parseExperimentParams(body: Record<string, unknown>): ExperimentParams {
  if (!record(body)) throw new Error('仿真参数必须是对象')
  const q = record(body.qlearning) ? body.qlearning : null
  const red = record(body.red) ? body.red : null
  const epsilon = bounded(q?.epsilon, 0, 1)
  const epsilonMin = bounded(q?.epsilonMin, 0, Math.min(epsilon ?? 0.3, 1))
  const redMin = integer(red?.minThresholdPackets, 0, 512)
  const redMax = integer(red?.maxThresholdPackets, redMin ?? 2, 512) ?? Math.max(6, redMin ?? 2)
  return {
    topology: (TOPOLOGIES.includes(String(body.topology)) ? body.topology : 'ring') as TopologyId,
    algorithm: (ALGORITHMS.includes(String(body.algorithm)) ? body.algorithm : 'dijkstra') as Algorithm,
    seed: integer(body.seed, 0, 0xffffffff) ?? 20260727,
    runs: integer(body.runs, 1, 20) ?? 1,
    nodeCount: integer(body.nodeCount, 6, 24),
    spineCount: integer(body.spineCount, 2, 8),
    leafCount: integer(body.leafCount, 2, 16),
    source: typeof body.source === 'string' && body.source.length <= 64 && body.source ? body.source : undefined,
    destination: typeof body.destination === 'string' && body.destination.length <= 64 && body.destination ? body.destination : undefined,
    queueCapacityPackets: integer(body.queueCapacityPackets, 1, 512),
    scheduler: body.scheduler === 'priority' ? 'priority' : 'fifo',
    discipline: body.discipline === 'red' ? 'red' : 'droptail',
    red: red ? {
      minThresholdPackets: redMin === undefined ? undefined : Math.min(redMin, redMax),
      maxThresholdPackets: redMax,
      maxDropProbability: bounded(red.maxDropProbability, 0, 1),
      weight: bounded(red.weight, 0, 1),
    } : undefined,
    failureAtMs: integer(body.failureAtMs, 0, 5000) ?? 0,
    detectionDelayMs: integer(body.detectionDelayMs, 0, 2000) ?? 40,
    qlearning: q ? {
      episodes: integer(q.episodes, 1, 2000),
      alpha: bounded(q.alpha, 0, 1),
      gamma: bounded(q.gamma, 0, 1),
      epsilon,
      epsilonMin,
      epsilonDecay: bounded(q.epsilonDecay, 0, 1),
    } : undefined,
  }
}

// 扫描即使符合运行次数上限，仍须限制同步 Q 训练的预算（每个种子最多训练三组源宿）。
export function checkQTrainingBudget(episodes: number | undefined, qRuns: number): string | null {
  const budget = (episodes ?? 300) * qRuns
  return budget > 12000 ? `Q-Learning 每组源宿训练预计 ${budget} episodes，超过上限 12000。请减少训练轮数 / 扫描点 / 种子数。` : null
}

export function isAlgorithm(v: unknown): v is Algorithm {
  return typeof v === 'string' && ALGORITHMS.includes(v)
}
