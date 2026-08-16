/**
 * Q-Learning 路由 —— 修复原 demo 的三个缺陷：
 *  1. 状态不含目的地 → 多流 Q 表互相污染。此处状态为 (当前节点, 目的地)。
 *  2. 训练量 12 episode → 默认 300 episode，且输出训练曲线（奖励收敛 + 贪心路径代价）。
 *  3. 失败静默回退 Dijkstra 掩盖学习效果 → 如实上报 fellBackToDijkstra。
 */

import type { Adjacency, Neighbor } from './topology'
import { dijkstra, edgeDecisionCost } from './routing'
import type { Rng } from './rng'
import type { QTrainingPoint, QTrainingReport } from './types'

export interface QRouterOptions {
  episodes?: number
  alpha?: number
  gamma?: number
  epsilon?: number
  epsilonMin?: number
  epsilonDecay?: number
}

const ARRIVAL_BONUS = 20
const STEP_BACK_PENALTY = 5

export class QRouter {
  private q = new Map<string, number>() // "node|dst>neighborIdx" -> value
  private alpha: number
  private gamma: number
  private epsilon: number
  private epsilonMin: number
  private epsilonDecay: number
  readonly episodes: number

  constructor(
    private adj: Adjacency,
    private edgeLoads: Map<string, number>,
    private congestionWeight: number,
    opts: QRouterOptions = {}
  ) {
    this.episodes = opts.episodes ?? 300
    this.alpha = opts.alpha ?? 0.3
    this.gamma = opts.gamma ?? 0.8
    this.epsilon = opts.epsilon ?? 0.3
    this.epsilonMin = opts.epsilonMin ?? 0.03
    this.epsilonDecay = opts.epsilonDecay ?? 0.995
  }

  private qKey(nodeIdx: number, dstIdx: number, neighborIdx: number): string {
    return `${nodeIdx}|${dstIdx}>${neighborIdx}`
  }

  private maxQ(nodeIdx: number, dstIdx: number): number {
    let best = -Infinity
    for (const { to } of this.adj.out[nodeIdx]) {
      const v = this.q.get(this.qKey(nodeIdx, dstIdx, to)) ?? 0
      if (v > best) best = v
    }
    return best === -Infinity ? 0 : best
  }

  /** 单条流 (src→dst) 的 epsilon-greedy 训练，返回训练报告 */
  train(source: string, destination: string, rng: Rng): QTrainingReport {
    const srcIdx = this.adj.nodeIndex.get(source)
    const dstIdx = this.adj.nodeIndex.get(destination)
    if (srcIdx === undefined || dstIdx === undefined) {
      return { episodes: 0, finalEpsilon: 0, successRate: 0, curve: [], foundPath: false, fellBackToDijkstra: true }
    }

    const maxSteps = 3 * this.adj.nodes.length
    const curve: QTrainingPoint[] = []
    let successes = 0
    const sampleEvery = Math.max(1, Math.floor(this.episodes / 50))

    for (let ep = 1; ep <= this.episodes; ep++) {
      let current = srcIdx
      let totalReward = 0
      const visited = new Set<number>()
      let reached = false

      for (let step = 0; step < maxSteps; step++) {
        if (current === dstIdx) {
          reached = true
          break
        }
        const neighbors = this.adj.out[current].filter(({ to }) => !visited.has(to))
        if (neighbors.length === 0) {
          totalReward -= STEP_BACK_PENALTY
          break
        }
        // 动作选择：epsilon-greedy
        let action: Neighbor
        if (rng() < this.epsilon) {
          action = neighbors[Math.floor(rng() * neighbors.length)]
        } else {
          let bestV = -Infinity
          let cands: Neighbor[] = []
          for (const nb of neighbors) {
            const v = this.q.get(this.qKey(current, dstIdx, nb.to)) ?? 0
            if (v > bestV + 1e-9) {
              bestV = v
              cands = [nb]
            } else if (Math.abs(v - bestV) <= 1e-9) {
              cands.push(nb)
            }
          }
          action = cands[Math.floor(rng() * cands.length)]
        }

        const nextNode = this.adj.nodes[action.to]
        const load = this.edgeLoads.get(action.edge.id) ?? 0
        const reward = -edgeDecisionCost(action.edge, nextNode.reliability, load, this.congestionWeight)
        const isArrival = action.to === dstIdx
        const r = isArrival ? reward + ARRIVAL_BONUS : reward

        // Q 更新
        const key = this.qKey(current, dstIdx, action.to)
        const nextMax = isArrival ? 0 : this.maxQ(action.to, dstIdx)
        const old = this.q.get(key) ?? 0
        this.q.set(key, old + this.alpha * (r + this.gamma * nextMax - old))

        totalReward += r
        visited.add(current)
        current = action.to
      }

      if (reached) successes++
      this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay)

      if (ep === 1 || ep % sampleEvery === 0 || ep === this.episodes) {
        const greedy = this.greedyCost(source, destination)
        curve.push({
          episode: ep,
          totalReward: Math.round(totalReward * 10) / 10,
          greedyPathCost: greedy,
          epsilon: Math.round(this.epsilon * 1000) / 1000,
          success: reached,
        })
      }
    }

    const path = this.greedyPath(source, destination)
    const foundPath = path.length > 0
    return {
      episodes: this.episodes,
      finalEpsilon: Math.round(this.epsilon * 1000) / 1000,
      successRate: Math.round((successes / this.episodes) * 1000) / 1000,
      curve,
      foundPath,
      fellBackToDijkstra: !foundPath,
    }
  }

  /** 贪心走 Q 表；死路返回 []（由调用方决定回退并如实记录） */
  greedyPath(source: string, destination: string): string[] {
    const srcIdx = this.adj.nodeIndex.get(source)
    const dstIdx = this.adj.nodeIndex.get(destination)
    if (srcIdx === undefined || dstIdx === undefined) return []
    const visited = new Set<number>([srcIdx])
    const path = [this.adj.nodes[srcIdx].id]
    let current = srcIdx
    for (let step = 0; step < 3 * this.adj.nodes.length; step++) {
      if (current === dstIdx) return path
      let bestV = -Infinity
      let next = -1
      for (const { to } of this.adj.out[current]) {
        if (visited.has(to)) continue
        const v = this.q.get(this.qKey(current, dstIdx, to)) ?? 0
        if (v > bestV) {
          bestV = v
          next = to
        }
      }
      if (next === -1) return []
      visited.add(next)
      path.push(this.adj.nodes[next].id)
      current = next
    }
    return []
  }

  /** 当前贪心策略的路径决策代价（用于训练曲线），不可达时取 Dijkstra 代价上界 */
  greedyCost(source: string, destination: string): number {
    const path = this.greedyPath(source, destination)
    if (path.length === 0) {
      return dijkstra(this.adj, source, destination, this.edgeLoads, this.congestionWeight).cost
    }
    let cost = 0
    for (let i = 0; i < path.length - 1; i++) {
      const u = this.adj.nodeIndex.get(path[i])!
      const v = this.adj.nodeIndex.get(path[i + 1])!
      const link = this.adj.out[u].find(({ to }) => to === v)
      if (!link) continue
      cost += edgeDecisionCost(link.edge, this.adj.nodes[v].reliability, this.edgeLoads.get(link.edge.id) ?? 0, this.congestionWeight)
    }
    return Math.round(cost * 10) / 10
  }
}
