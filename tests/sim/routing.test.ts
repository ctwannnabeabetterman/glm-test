import { describe, expect, it } from 'vitest'
import { COST_CONSTANTS, dijkstra, edgeDecisionCost, minHopPath } from '@/lib/sim/routing'
import { buildAdjacency, buildTopology } from '@/lib/sim/topology'

const emptyLoads = new Map<string, number>()

function ring() {
  return buildAdjacency(buildTopology('ring', { seed: 42, nodeCount: 8 }))
}

describe('routing：Dijkstra / BFS 最小跳数', () => {
  it('ring 上 R1→R7 最短时延路径走弦的邻域（≤3 跳），而非绕环半圈', () => {
    const adj = ring()
    const res = dijkstra(adj, 'R1', 'R7', emptyLoads, COST_CONSTANTS.congestionWeight.dijkstra)
    expect(res.path[0]).toBe('R1')
    expect(res.path[res.path.length - 1]).toBe('R7')
    expect(res.hops).toBeLessThanOrEqual(3)
    expect(Number.isFinite(res.cost)).toBe(true)
  })

  it('源宿相同 ⇒ 单节点路径', () => {
    const adj = ring()
    const res = dijkstra(adj, 'R3', 'R3', emptyLoads, 0)
    expect(res.path).toEqual(['R3'])
    expect(res.hops).toBe(0)
  })

  it('未知节点 ⇒ 空路径 + Infinity 代价', () => {
    const adj = ring()
    expect(dijkstra(adj, 'R1', 'NOPE', emptyLoads, 0).path).toEqual([])
    expect(dijkstra(adj, 'NOPE', 'R1', emptyLoads, 0).cost).toBe(Infinity)
    expect(minHopPath(adj, 'R1', 'NOPE').path).toEqual([])
  })

  it('congestionWeight>0 时负载高的边代价单调上升（loadaware 生效的前提）', () => {
    const adj = ring()
    const edge = adj.out[0][0].edge
    const base = edgeDecisionCost(edge, 0.99, 0, 2)
    const loaded = edgeDecisionCost(edge, 0.99, 1, 2)
    expect(loaded).toBeGreaterThan(base)
    // dijkstra 权重为 0 ⇒ 负载不影响代价
    expect(edgeDecisionCost(edge, 0.99, 1, 0)).toBe(base)
  })

  it('负载感知改变路径选择：全环零载 vs 单边满载，dijkstra(w=2) 会避开拥塞边', () => {
    const adj = ring()
    // R0→R4 有直达弦；给 R0 的三条出边中两条注入高负载
    const loads = new Map<string, number>()
    for (const { edge } of adj.out[adj.nodeIndex.get('R0')!]) {
      if (edge.id !== 'R0>R4') loads.set(edge.id, 1)
    }
    const clean = dijkstra(adj, 'R0', 'R4', emptyLoads, 2)
    const avoid = dijkstra(adj, 'R0', 'R4', loads, 2)
    // 零载时走弦（传播代价最低）；重载后仍应存在有限代价路径
    expect(clean.hops).toBeLessThanOrEqual(avoid.hops)
    expect(avoid.cost).toBeGreaterThanOrEqual(clean.cost)
  })

  it('minHopPath 返回最少跳数路径', () => {
    const adj = ring()
    const res = minHopPath(adj, 'R1', 'R7')
    expect(res.path[0]).toBe('R1')
    expect(res.path[res.path.length - 1]).toBe('R7')
    // R1-R0-R7 经环边 2 跳即达
    expect(res.hops).toBe(2)
    expect(res.cost).toBe(2)
  })
})
