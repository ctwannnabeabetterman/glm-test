import { describe, expect, it } from 'vitest'
import { buildAdjacency, buildTopology, defaultFlows } from '@/lib/sim/topology'

describe('topology：三类拓扑均由 (seed, 参数) 确定性生成', () => {
  it('ring：n 节点单环 + 2 条跨环弦路', () => {
    const t = buildTopology('ring', { seed: 42, nodeCount: 8 })
    expect(t.id).toBe('ring')
    expect(t.nodes).toHaveLength(8)
    // 环边 8 + 弦 2，每条物理边记录一次
    expect(t.edges).toHaveLength(10)
    expect(t.defaultPair).toEqual({ source: 'R0', destination: 'R4' })
  })

  it('spineleaf：spines × leaves 全互联 + 每叶一主机', () => {
    const t = buildTopology('spineleaf', { seed: 42, spineCount: 3, leafCount: 5 })
    expect(t.nodes.filter((n) => n.role === 'spine')).toHaveLength(3)
    expect(t.nodes.filter((n) => n.role === 'leaf')).toHaveLength(5)
    expect(t.nodes.filter((n) => n.role === 'host')).toHaveLength(5)
    expect(t.edges).toHaveLength(3 * 5 + 5) // S×L 全互联 + L→H
  })

  it('mesh：k=3 最近邻图，M0 为网关，参数越界被钳制', () => {
    const t = buildTopology('mesh', { seed: 7, nodeCount: 12 })
    expect(t.nodes[0].id).toBe('M0')
    expect(t.nodes[0].role).toBe('gateway')
    // 每点提议 k 条最近邻边、双向去重 ⇒ 边数 ≤ n·k（k 近邻关系非全局对称）
    expect(t.edges.length).toBeGreaterThan(0)
    expect(t.edges.length).toBeLessThanOrEqual(12 * 3)
    // 钳制：nodeCount 上限 24
    const big = buildTopology('mesh', { seed: 7, nodeCount: 999 })
    expect(big.nodes).toHaveLength(24)
  })

  it('同参数两次构建 ⇒ 字节级一致（修复 Math.random 缺陷的回归测试）', () => {
    for (const id of ['ring', 'mesh'] as const) {
      const a = JSON.stringify(buildTopology(id, { seed: 123 }))
      const b = JSON.stringify(buildTopology(id, { seed: 123 }))
      expect(a).toBe(b)
    }
    // 不同种子 ⇒ 拓扑参数（如 mesh 链路 lossRate）不同
    const c = JSON.stringify(buildTopology('mesh', { seed: 124 }))
    expect(JSON.stringify(buildTopology('mesh', { seed: 123 }))).not.toBe(c)
  })

  it('defaultFlows：三流业务（URLLC/eMBB/mMTC），优先级互异', () => {
    const t = buildTopology('ring', { seed: 42 })
    const flows = defaultFlows(t)
    expect(flows.map((f) => f.className)).toEqual(['urllc', 'embb', 'mmtc'])
    const prios = new Set(flows.map((f) => f.priority))
    expect(prios.size).toBe(3)
    for (const f of flows) {
      expect(f.packetCount).toBeGreaterThan(f.warmupPackets)
    }
  })

  it('buildAdjacency：无向双向索引，出边对称', () => {
    const t = buildTopology('ring', { seed: 1, nodeCount: 8 })
    const adj = buildAdjacency(t)
    expect(adj.nodeIndex.get('R0')).toBe(0)
    // R0 出边：环邻居 R1/R7 + 弦 R4 = 3 条
    expect(adj.out[0]).toHaveLength(3)
    for (const e of t.edges.slice(0, 3)) {
      const a = adj.nodeIndex.get(e.from)!
      const b = adj.nodeIndex.get(e.to)!
      expect(adj.out[a].some((n) => n.to === b)).toBe(true)
      expect(adj.out[b].some((n) => n.to === a)).toBe(true)
    }
  })
})
