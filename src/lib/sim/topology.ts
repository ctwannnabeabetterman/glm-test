/**
 * 拓扑模板 —— 全部由 (seed, 参数) 确定性生成，修复原 demo 用 Math.random() 不可复现的问题。
 * 三类典型拓扑：环形骨干网 / Spine-Leaf 数据中心 / 自组织 Mesh。
 */

import type { SimEdge, SimNode, Topology, TopologyId } from './types'
import { deriveStream, randFloat, randInt, type Rng } from './rng'

export const TOPOLOGY_META: { id: TopologyId; name: string; description: string; recommended: string[] }[] = [
  { id: 'ring', name: '环形骨干网', description: '城域/骨干环形拓扑，含跨环弦路，考察最短路与时延权衡', recommended: ['dijkstra', 'loadaware'] },
  { id: 'spineleaf', name: 'Spine-Leaf 数据中心', description: '叶脊全互联 fabric，考察等价多路径下的负载均衡', recommended: ['loadaware', 'qlearning'] },
  { id: 'mesh', name: '自组织 Mesh 网络', description: '无线多跳自组网，链路质量异构，考察 Q-Learning 自适应路由', recommended: ['qlearning', 'loadaware'] },
]

function edgeId(from: string, to: string): string {
  return `${from}>${to}`
}

/** 环形骨干网：n 节点单环 + 2 条种子化弦路 */
function buildRing(n: number, seed: number): Topology {
  const rng = deriveStream(seed, 'ring-topology')
  const nodes: SimNode[] = Array.from({ length: n }, (_, i) => ({
    id: `R${i}`,
    role: 'core' as const,
    procDelayMs: 2 + (i % 3),
    capacity: 10,
    reliability: 0.99,
  }))
  const edges: SimEdge[] = []
  for (let i = 0; i < n; i++) {
    edges.push({
      id: edgeId(`R${i}`, `R${(i + 1) % n}`),
      from: `R${i}`,
      to: `R${(i + 1) % n}`,
      propagationMs: 10,
      bandwidthMbps: 10,
      lossRate: 0.005,
    })
  }
  // 两条跨环弦：跨度约半个环，带宽略低（避开与环边完全等价）
  const half = Math.floor(n / 2)
  for (const i of [0, Math.floor(n / 4)]) {
    const j = (i + half) % n
    edges.push({
      id: edgeId(`R${i}`, `R${j}`),
      from: `R${i}`,
      to: `R${j}`,
      propagationMs: 14,
      bandwidthMbps: randInt(rng, 6, 8),
      lossRate: 0.008,
    })
  }
  return {
    id: 'ring',
    nodes,
    edges,
    defaultPair: { source: 'R0', destination: `R${Math.floor(n / 2)}` },
    description: `${n} 节点环形骨干网 + 2 条跨环弦路`,
  }
}

/** Spine-Leaf：spines × leaves 全互联 + 每叶挂一台主机 */
function buildSpineLeaf(spines: number, leaves: number): Topology {
  const nodes: SimNode[] = []
  for (let i = 0; i < spines; i++) {
    nodes.push({ id: `S${i}`, role: 'spine', procDelayMs: 1, capacity: 10, reliability: 0.999 })
  }
  for (let i = 0; i < leaves; i++) {
    nodes.push({ id: `L${i}`, role: 'leaf', procDelayMs: 1.5, capacity: 8, reliability: 0.995 })
  }
  for (let i = 0; i < leaves; i++) {
    nodes.push({ id: `H${i}`, role: 'host', procDelayMs: 0.5, capacity: 5, reliability: 0.99 })
  }
  const edges: SimEdge[] = []
  for (let s = 0; s < spines; s++) {
    for (let l = 0; l < leaves; l++) {
      edges.push({
        id: edgeId(`S${s}`, `L${l}`),
        from: `S${s}`,
        to: `L${l}`,
        propagationMs: 4,
        bandwidthMbps: 10,
        lossRate: 0.001,
      })
    }
  }
  for (let l = 0; l < leaves; l++) {
    edges.push({
      id: edgeId(`L${l}`, `H${l}`),
      from: `L${l}`,
      to: `H${l}`,
      propagationMs: 2,
      bandwidthMbps: 5,
      lossRate: 0.002,
    })
  }
  return {
    id: 'spineleaf',
    nodes,
    edges,
    defaultPair: { source: 'H0', destination: `H${leaves - 1}` },
    description: `${spines} Spine × ${leaves} Leaf 全互联 + ${leaves} 主机`,
  }
}

/** 自组织 Mesh：单位正方形内撒点，连接每点最近的 k 个邻居，链路质量随距离劣化 */
function buildMesh(n: number, seed: number): Topology {
  const rng = deriveStream(seed, 'mesh-topology')
  const positions: { x: number; y: number }[] = Array.from({ length: n }, () => ({ x: rng(), y: rng() }))
  const nodes: SimNode[] = Array.from({ length: n }, (_, i) => ({
    id: `M${i}`,
    role: (i === 0 ? 'gateway' : 'mesh') as SimNode['role'],
    procDelayMs: 3 + (i % 5),
    capacity: randInt(rng, 4, 7),
    reliability: randFloat(rng, 0.91, 0.98),
  }))

  const edges: SimEdge[] = []
  const seen = new Set<string>()
  const K = 3
  for (let i = 0; i < n; i++) {
    const dists = positions
      .map((p, j) => ({ j, d: Math.hypot(p.x - positions[i].x, p.y - positions[i].y) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
    for (const { j, d } of dists.slice(0, K)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`
      if (seen.has(key)) continue
      seen.add(key)
      const distScaled = d * 100
      edges.push({
        id: edgeId(`M${i}`, `M${j}`),
        from: `M${i}`,
        to: `M${j}`,
        propagationMs: Math.max(2, Math.round(distScaled / 30)),
        bandwidthMbps: randInt(rng, 5, 7),
        lossRate: Number(randFloat(rng, 0.02, 0.08).toFixed(3)),
      })
    }
  }
  return {
    id: 'mesh',
    nodes,
    edges,
    defaultPair: { source: 'M1', destination: 'M0' },
    description: `${n} 节点自组织 Mesh（k=3 最近邻，M0 为网关）`,
  }
}

export function buildTopology(id: TopologyId, params: { seed: number; nodeCount?: number; spineCount?: number; leafCount?: number }): Topology {
  switch (id) {
    case 'ring':
      return buildRing(clampInt(params.nodeCount ?? 8, 6, 12), params.seed)
    case 'spineleaf':
      return buildSpineLeaf(clampInt(params.spineCount ?? 4, 2, 8), clampInt(params.leafCount ?? 6, 2, 16))
    case 'mesh':
      return buildMesh(clampInt(params.nodeCount ?? 12, 8, 24), params.seed)
  }
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, Math.round(v)))
}

/** 默认三流业务（URLLC / eMBB / mMTC），源宿取自拓扑推荐对（错开源点制造交叉流量） */
export function defaultFlows(topo: Topology): import('./types').TrafficFlow[] {
  const { source, destination } = topo.defaultPair
  const altSource = topo.nodes.find((nd) => nd.id !== source && nd.id !== destination)?.id ?? source
  return [
    { id: 'urllc-1', className: 'urllc', priority: 0, source, destination, packetCount: 20, warmupPackets: 3, packetIntervalMs: 30, startAtMs: 20, packetSizeKb: 128 },
    { id: 'embb-1', className: 'embb', priority: 4, source: altSource, destination, packetCount: 20, warmupPackets: 3, packetIntervalMs: 30, startAtMs: 0, packetSizeKb: 1000 },
    { id: 'mmtc-1', className: 'mmtc', priority: 6, source: altSource, destination, packetCount: 20, warmupPackets: 3, packetIntervalMs: 15, startAtMs: 120, packetSizeKb: 256 },
  ]
}

/** 无向图邻接索引（含平行边），O(1) 查邻边 */
export interface Neighbor {
  to: number
  edge: SimEdge
}

export interface Adjacency {
  nodeIndex: Map<string, number>
  nodes: SimNode[]
  /** nodeId -> 出边列表（双向边两个方向各一条） */
  out: Neighbor[][]
}

export function buildAdjacency(topo: Topology): Adjacency {
  const nodeIndex = new Map(topo.nodes.map((nd, i) => [nd.id, i]))
  const out: { to: number; edge: SimEdge }[][] = topo.nodes.map(() => [])
  for (const e of topo.edges) {
    const a = nodeIndex.get(e.from)
    const b = nodeIndex.get(e.to)
    if (a === undefined || b === undefined) continue
    out[a].push({ to: b, edge: e })
    out[b].push({ to: a, edge: e })
  }
  return { nodeIndex, nodes: topo.nodes, out }
}

export { edgeId }
export type { Rng }
