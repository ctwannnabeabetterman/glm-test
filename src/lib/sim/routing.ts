/**
 * 路由算法 —— Dijkstra（二叉堆实现）/ 最小跳数 BFS。
 * 「代价」是路由决策度量（无量纲），与物理时延分开建模，不再混用拍脑袋常数。
 */

import type { Adjacency } from './topology'
import type { SimEdge } from './types'

/** 路由代价模型的显式常数（等效 ms，可调） */
export const COST_CONSTANTS = {
  /** 每单位丢包率的代价惩罚 */
  lossPenalty: 30,
  /** 每单位不可靠度的代价惩罚 */
  unreliabilityPenalty: 20,
  /** 负载感知算法对拥塞的敏感系数（dijkstra=0 即纯最短传播时延；qlearning 学习目标与 loadaware 对齐） */
  congestionWeight: { dijkstra: 0, loadaware: 2, qlearning: 2 } as Record<string, number>,
}

/** 邻边代价：传播时延 + 拥塞惩罚 + 丢包/不可靠惩罚 */
export function edgeDecisionCost(
  edge: SimEdge,
  dstReliability: number,
  edgeLoad: number,
  congestionWeight: number
): number {
  return (
    edge.propagationMs +
    congestionWeight * edge.propagationMs * edgeLoad +
    edge.lossRate * COST_CONSTANTS.lossPenalty +
    (1 - dstReliability) * COST_CONSTANTS.unreliabilityPenalty
  )
}

export interface PathResult {
  path: string[]
  /** 决策代价总和 */
  cost: number
  /** 物理路径时延：传播 + 目的节点处理（传输时延由队列仿真单独计） */
  propagationMs: number
  hops: number
}

/** 二叉堆 Dijkstra。congestionWeight=0 → 经典最短时延；>0 → 负载感知 */
export function dijkstra(
  adj: Adjacency,
  source: string,
  destination: string,
  edgeLoads: Map<string, number>,
  congestionWeight: number
): PathResult {
  const n = adj.nodes.length
  const srcIdx = adj.nodeIndex.get(source)
  const dstIdx = adj.nodeIndex.get(destination)
  if (srcIdx === undefined || dstIdx === undefined) return { path: [], cost: Infinity, propagationMs: 0, hops: 0 }

  const dist = new Float64Array(n).fill(Infinity)
  const prevNode = new Int32Array(n).fill(-1)
  const prevEdge = new Array<SimEdge | null>(n).fill(null)
  dist[srcIdx] = 0

  // 简单二叉堆 [dist, node]
  const heap: [number, number][] = [[0, srcIdx]]
  const inHeap = new Uint8Array(n)
  const push = (item: [number, number]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = (): [number, number] | undefined => {
    if (heap.length === 0) return undefined
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }

  while (heap.length > 0) {
    const [d, u] = pop()!
    if (inHeap[u] && d > dist[u]) continue
    inHeap[u] = 0
    if (u === dstIdx) break
    for (const { to: v, edge } of adj.out[u]) {
      const load = edgeLoads.get(edge.id) ?? 0
      const w = edgeDecisionCost(edge, adj.nodes[v].reliability, load, congestionWeight)
      const nd = d + w
      if (nd < dist[v] - 1e-12) {
        dist[v] = nd
        prevNode[v] = u
        prevEdge[v] = edge
        inHeap[v] = 1
        push([nd, v])
      }
    }
  }

  if (!Number.isFinite(dist[dstIdx])) return { path: [], cost: Infinity, propagationMs: 0, hops: 0 }
  const path: string[] = []
  let prop = 0
  for (let v = dstIdx; v !== -1; v = prevNode[v]) {
    path.unshift(adj.nodes[v].id)
    const pe = prevEdge[v]
    if (pe) prop += pe.propagationMs + adj.nodes[v].procDelayMs
  }
  return { path, cost: dist[dstIdx], propagationMs: Math.round(prop * 10) / 10, hops: path.length - 1 }
}

/** BFS 最小跳数路径 */
export function minHopPath(adj: Adjacency, source: string, destination: string): PathResult {
  const n = adj.nodes.length
  const srcIdx = adj.nodeIndex.get(source)
  const dstIdx = adj.nodeIndex.get(destination)
  if (srcIdx === undefined || dstIdx === undefined) return { path: [], cost: Infinity, propagationMs: 0, hops: 0 }
  const prev = new Int32Array(n).fill(-2)
  prev[srcIdx] = -1
  const queue = [srcIdx]
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi]
    if (u === dstIdx) break
    for (const { to: v } of adj.out[u]) {
      if (prev[v] === -2) {
        prev[v] = u
        queue.push(v)
      }
    }
  }
  if (prev[dstIdx] === -2) return { path: [], cost: Infinity, propagationMs: 0, hops: 0 }
  const path: string[] = []
  for (let v = dstIdx; v !== -1; v = prev[v]) path.unshift(adj.nodes[v].id)
  return { path, cost: path.length - 1, propagationMs: 0, hops: path.length - 1 }
}
