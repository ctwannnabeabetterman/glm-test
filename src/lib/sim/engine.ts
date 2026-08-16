/**
 * 离散事件仿真引擎 —— 单一确定性事件队列（时间 → 事件类型优先级 → 序号），
 * 替代原 demo「动画引擎 + 批引擎」双轨不一致的结构：
 *  - FAULT(0) < DETECT(1) < SERVICE_END(2) < EMIT(3)
 *  - 每条有向边独立建模：单服务台 + 等待队列（drop-tail / RED）
 *  - 丢包判定与队列状态解耦的问题已修正：链路误码丢包逐跳判定，拥塞丢包在入队判定
 */

import { buildAdjacency, buildTopology, defaultFlows } from './topology'
import { COST_CONSTANTS, dijkstra } from './routing'
import { QRouter } from './qlearning'
import { deriveStream, type Rng } from './rng'
import type {
  Algorithm,
  DropReason,
  ExperimentParams,
  FlowMetrics,
  QTrainingReport,
  SimMetrics,
  SingleRunResult,
  Topology,
  TrafficFlow,
} from './types'

interface SimEvent {
  time: number
  rank: 0 | 1 | 2 | 3 // fault < detect < service_end < emit
  seq: number
  type: 'fault' | 'detect' | 'service_end' | 'emit'
  flowIdx?: number
  packetSeq?: number
  edgeKey?: string
  packetId?: string
}

interface Packet {
  id: string
  flowIdx: number
  seq: number
  emitTime: number
  path: string[]
  pathIdx: number
  sizeKb: number
  queueDelayMs: number
  delivered: boolean
  arrivalTime: number
  dropped: null | DropReason
  measured: boolean
  lastEnqueueTime: number
}

interface EdgeQueueState {
  queue: string[] // 排队 packetId
  busyUntil: number
  serving: string | null
  peakDepth: number
  redAvg: number
  redCountSinceDrop: number
  lastServiceStart: number
  carried: number
}

const EMPTY_REASONS: Record<DropReason, number> = {
  'queue-full': 0,
  'red-early-drop': 0,
  'link-loss': 0,
  'link-failure': 0,
  'no-route': 0,
  congestion: 0,
}

function jainIndex(xs: number[]): number {
  const vals = xs.filter((x) => x > 0)
  if (vals.length === 0) return 1
  const sum = vals.reduce((a, b) => a + b, 0)
  const sq = vals.reduce((a, b) => a + b * b, 0)
  return sq === 0 ? 1 : (sum * sum) / (vals.length * sq)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

const r1 = (x: number) => Math.round(x * 10) / 10

/** 执行单次（单种子）实验 */
export function runSingle(params: ExperimentParams, seed: number): SingleRunResult {
  const topo: Topology = buildTopology(params.topology, {
    seed,
    nodeCount: params.nodeCount,
    spineCount: params.spineCount,
    leafCount: params.leafCount,
  })
  const adj = buildAdjacency(topo)
  const flows: TrafficFlow[] = defaultFlows(topo)
  if (params.source) flows[0].source = params.source
  if (params.destination) flows[0].destination = params.destination

  const algorithm: Algorithm = params.algorithm
  const edgeLoads = new Map<string, number>()
  const congestionWeight = COST_CONSTANTS.congestionWeight[algorithm] ?? 0

  // ---- Q-Learning 预训练（每条流独立训练，状态含目的地）----
  let training: QTrainingReport | undefined
  let router: QRouter | null = null
  if (algorithm === 'qlearning') {
    router = new QRouter(adj, edgeLoads, congestionWeight, params.qlearning ?? {})
    const pairs = new Map<string, { src: string; dst: string }>()
    flows.forEach((f) => pairs.set(`${f.source}>${f.destination}`, { src: f.source, dst: f.destination }))
    for (const [key, pair] of pairs) {
      const report = router.train(pair.src, pair.dst, deriveStream(seed, `qlearning:${key}`))
      if (!training) training = report
    }
  }

  // ---- 状态 ----
  const failedPhysical = new Set<string>() // 物理故障（丢包 link-failure）
  const removedFromRouting = new Set<string>() // 检测后从路由图移除
  const queues = new Map<string, EdgeQueueState>()
  const packets = new Map<string, Packet>()
  const edgeById = new Map(topo.edges.map((e) => [e.id, e]))
  /** 有向边 key "A>B" -> SimEdge（两个方向各一条，指向同一物理边） */
  const directedEdge = new Map<string, (typeof topo.edges)[number]>()
  for (let u = 0; u < adj.nodes.length; u++) {
    for (const { to, edge } of adj.out[u]) {
      directedEdge.set(`${adj.nodes[u].id}>${adj.nodes[to].id}`, edge)
    }
  }
  /** 持久随机流注册表：同名流每次调用推进序列，保证不重复 */
  const streamRegistry = new Map<string, Rng>()
  const stream = (name: string): Rng => {
    let s = streamRegistry.get(name)
    if (!s) {
      s = deriveStream(seed, name)
      streamRegistry.set(name, s)
    }
    return s
  }
  const queueCap = params.queueCapacityPackets ?? 8
  const scheduler = params.scheduler ?? 'fifo'
  const discipline = params.discipline ?? 'droptail'
  const red = {
    minTh: params.red?.minThresholdPackets ?? 2,
    maxTh: params.red?.maxThresholdPackets ?? 6,
    maxP: params.red?.maxDropProbability ?? 0.1,
    weight: params.red?.weight ?? 0.2,
  }

  const queueOf = (key: string): EdgeQueueState => {
    let q = queues.get(key)
    if (!q) {
      q = { queue: [], busyUntil: 0, serving: null, peakDepth: 0, redAvg: 0, redCountSinceDrop: 0, lastServiceStart: 0, carried: 0 }
      queues.set(key, q)
    }
    return q
  }

  // ---- 事件队列 ----
  let seqCounter = 0
  const events: SimEvent[] = []
  const pushEvent = (e: Omit<SimEvent, 'seq'>) => events.push({ ...e, seq: seqCounter++ })
  events.sort((a, b) => a.time - b.time || a.rank - b.rank || a.seq - b.seq)

  const emitAll = () => {
    flows.forEach((f, fi) => {
      for (let i = 0; i < f.packetCount; i++) {
        pushEvent({ time: f.startAtMs + i * f.packetIntervalMs, rank: 3, type: 'emit', flowIdx: fi, packetSeq: i })
      }
    })
  }
  emitAll()

  // 故障注入：主流路径第一条边
  let failureEdgeId: string | null = null
  if (params.failureAtMs && params.failureAtMs > 0) {
    const primary = flows[0]
    const pre = routePath(primary.source, primary.destination)
    failureEdgeId = pre.length > 1 ? firstEdgeOnPath(pre) : topo.edges[0].id
    if (failureEdgeId) {
      pushEvent({ time: params.failureAtMs, rank: 0, type: 'fault' })
      pushEvent({ time: params.failureAtMs + (params.detectionDelayMs ?? 40), rank: 1, type: 'detect' })
    }
  }

  function firstEdgeOnPath(path: string[]): string | null {
    const a = adj.nodeIndex.get(path[0])
    const b = adj.nodeIndex.get(path[1])
    if (a === undefined || b === undefined) return null
    const link = adj.out[a].find(({ to }) => to === b)
    return link ? link.edge.id : null
  }

  function routePath(src: string, dst: string): string[] {
    if (src === dst) return [src]
    if (algorithm === 'qlearning' && router) {
      const p = router.greedyPath(src, dst)
      if (p.length > 1) return p
      // 学习失败 → 回退（会在训练报告里如实标注）
      return dijkstra(adj, src, dst, edgeLoads, congestionWeight).path
    }
    return dijkstra(adj, src, dst, edgeLoads, congestionWeight).path
  }

  /** 路由图中的边是否可用（检测到的故障已移除） */
  const edgeUsable = (edgeId: string): boolean => !removedFromRouting.has(edgeId)

  /** 入队/立即服务；返回 false = 被丢弃（已计数） */
  function enqueuePacket(packet: Packet, from: string, to: string, now: number, dropCounter: (r: DropReason) => void): boolean {
    const a = adj.nodeIndex.get(from)
    const b = adj.nodeIndex.get(to)
    if (a === undefined || b === undefined) return false
    const link = adj.out[a].find(({ to: t, edge }) => t === b && edgeUsable(edge.id))
    if (!link) {
      dropCounter('no-route')
      return false
    }
    const edge = link.edge
    if (failedPhysical.has(edge.id)) {
      dropCounter('link-failure')
      return false
    }
    const key = `${from}>${to}`
    const q = queueOf(key)
    q.carried++
    const serviceMs = Math.max(0.1, packet.sizeKb / edge.bandwidthMbps)

    const tryStartService = (t: number) => {
      if (q.serving === null && q.queue.length === 0) {
        q.serving = packet.id
        q.busyUntil = t + serviceMs
        q.lastServiceStart = t
        pushEvent({ time: t + serviceMs, rank: 2, type: 'service_end', edgeKey: key, packetId: packet.id })
        return true
      }
      return false
    }

    if (q.serving !== null) {
      // 已有包在服务 → 排队
      if (discipline === 'droptail') {
        if (q.queue.length >= queueCap) {
          dropCounter('queue-full')
          return false
        }
      } else {
        // RED：EWMA 平均队长
        const depth = q.queue.length
        q.redAvg = (1 - red.weight) * q.redAvg + red.weight * depth
        if (q.redAvg >= red.maxTh) {
          dropCounter('red-early-drop')
          q.redCountSinceDrop = 0
          return false
        }
        if (q.redAvg >= red.minTh) {
          let p = red.maxP * ((q.redAvg - red.minTh) / Math.max(1, red.maxTh - red.minTh))
          p = p / (1 - q.redCountSinceDrop * p)
          if (stream(`red:${key}`)() < p) {
            dropCounter('red-early-drop')
            q.redCountSinceDrop = 0
            return false
          }
          q.redCountSinceDrop++
        }
        if (q.queue.length >= queueCap * 2) {
          dropCounter('queue-full')
          return false
        }
      }
      // 优先级调度：priority 模式下按业务优先级插入
      const prio = flows[packet.flowIdx]?.priority ?? 4
      if (scheduler === 'priority') {
        let i = q.queue.length
        const ids = q.queue
        while (i > 0 && (flows[packets.get(ids[i - 1])?.flowIdx ?? 0]?.priority ?? 4) > prio) i--
        q.queue.splice(i, 0, packet.id)
      } else {
        q.queue.push(packet.id)
      }
      packet.lastEnqueueTime = now
      q.peakDepth = Math.max(q.peakDepth, q.queue.length)
      return true
    }
    packet.lastEnqueueTime = now
    return tryStartService(now)
  }

  /** 负载演化：发包路径上的边负载上升（与服务时间/带宽相关），其余衰减 */
  function advanceLoads(path: string[], sizeKb: number) {
    const onPath = new Set<string>()
    for (let i = 0; i < path.length - 1; i++) {
      const e = firstEdgeOnPath(path.slice(i, i + 2))
      if (!e) continue
      onPath.add(e)
      const edge = edgeById.get(e)
      if (!edge) continue
      const serviceMs = sizeKb / edge.bandwidthMbps
      const delta = Math.min(0.2, serviceMs / 300)
      edgeLoads.set(e, Math.min(1, (edgeLoads.get(e) ?? 0) + delta))
    }
    for (const e of edgeLoads.keys()) {
      if (!onPath.has(e)) edgeLoads.set(e, Math.max(0, (edgeLoads.get(e) ?? 0) - 0.02))
    }
  }

  // ---- 主循环 ----
  let firstDeliveryAfterDetect: number | null = null
  let detectTime: number | null = null
  const maxEvents = flows.reduce((a, f) => a + f.packetCount, 0) * (1 + 2 * topo.nodes.length * 2) + 64
  let processed = 0
  let ei = 0

  while (ei < events.length && processed < maxEvents) {
    // 重新取最小事件（service_end 会动态 push）
    events.sort((a, b) => a.time - b.time || a.rank - b.rank || a.seq - b.seq)
    const ev = events[ei++]
    if (!ev) break
    processed++

    if (ev.type === 'fault') {
      if (failureEdgeId) failedPhysical.add(failureEdgeId)
      continue
    }
    if (ev.type === 'detect') {
      if (failureEdgeId) removedFromRouting.add(failureEdgeId)
      detectTime = ev.time
      continue
    }
    if (ev.type === 'emit') {
      const flow = flows[ev.flowIdx!]
      const pid = `f${ev.flowIdx}-p${ev.packetSeq}`
      const path = routePath(flow.source, flow.destination)
      const packet: Packet = {
        id: pid,
        flowIdx: ev.flowIdx!,
        seq: ev.packetSeq!,
        emitTime: ev.time,
        path,
        pathIdx: 0,
        sizeKb: flow.packetSizeKb,
        queueDelayMs: 0,
        delivered: false,
        arrivalTime: 0,
        dropped: null,
        measured: ev.packetSeq! >= flow.warmupPackets,
        lastEnqueueTime: ev.time,
      }
      packets.set(pid, packet)
      advanceLoads(path, flow.packetSizeKb)
      if (path.length < 2) {
        packet.dropped = 'no-route'
        continue
      }
      enqueuePacket(packet, path[0], path[1], ev.time, (r) => (packet.dropped = r))
      continue
    }
    if (ev.type === 'service_end') {
      const q = queues.get(ev.edgeKey!)
      const packet = packets.get(ev.packetId!)
      if (!q || !packet) continue
      q.serving = null
      const [from, to] = ev.edgeKey!.split('>')
      // 送达下一节点：传播 + 节点处理
      const edge = directedEdge.get(ev.edgeKey!)
      const dstNode = adj.nodes[adj.nodeIndex.get(to)!]
      const hopArrival = ev.time + (edge?.propagationMs ?? 0) + dstNode.procDelayMs

      // 逐跳误码丢包（独立持久随机流）
      if (edge && stream(`drop:${edge.id}`)() > (1 - edge.lossRate) * dstNode.reliability) {
        packet.dropped = 'link-loss'
      } else if (packet.path[packet.pathIdx + 1] === to) {
        packet.pathIdx++
        if (to === packet.path[packet.path.length - 1]) {
          packet.delivered = true
          packet.arrivalTime = hopArrival
          if (detectTime !== null && hopArrival >= detectTime && firstDeliveryAfterDetect === null) {
            firstDeliveryAfterDetect = hopArrival
          }
        } else {
          const nextHop = packet.path[packet.pathIdx + 1]
          if (nextHop) {
            enqueuePacket(packet, to, nextHop, hopArrival, (r) => (packet.dropped = r))
          } else {
            packet.dropped = 'no-route'
          }
        }
      } else {
        packet.dropped = 'no-route'
      }

      // 服务台继续取下一个包
      if (q.queue.length > 0) {
        const nextId = q.queue.shift()!
        const nextPkt = packets.get(nextId)
        if (nextPkt && nextPkt.dropped === null) {
          const e2 = directedEdge.get(ev.edgeKey!)
          const serviceMs = Math.max(0.1, nextPkt.sizeKb / (e2?.bandwidthMbps ?? 10))
          nextPkt.queueDelayMs += ev.time - nextPkt.lastEnqueueTime
          q.serving = nextId
          q.busyUntil = ev.time + serviceMs
          pushEvent({ time: ev.time + serviceMs, rank: 2, type: 'service_end', edgeKey: ev.edgeKey, packetId: nextId })
        }
      }
      continue
    }
  }

  // ---- 统计（剔除预热包）----
  const measured = [...packets.values()].filter((p) => p.measured)
  const delivered = measured.filter((p) => p.delivered)
  const dropBy: Record<DropReason, number> = { ...EMPTY_REASONS }
  for (const p of measured) if (p.dropped) dropBy[p.dropped]++

  const latencies = delivered.map((p) => p.arrivalTime - p.emitTime).sort((a, b) => a - b)
  const jitter = (ls: number[]) => {
    if (ls.length < 2) return 0
    let s = 0
    for (let i = 1; i < ls.length; i++) s += Math.abs(ls[i] - ls[i - 1])
    return s / (ls.length - 1)
  }
  const window = measured.length > 0 ? Math.max(...measured.map((p) => p.delivered ? p.arrivalTime : p.emitTime)) - Math.min(...measured.map((p) => p.emitTime)) : 0

  const flowMetrics: FlowMetrics[] = flows.map((f, fi) => {
    const fp = measured.filter((p) => p.flowIdx === fi)
    const fd = fp.filter((p) => p.delivered)
    const fl = fd.map((p) => p.arrivalTime - p.emitTime).sort((a, b) => a - b)
    const reasons: Record<DropReason, number> = { ...EMPTY_REASONS }
    for (const p of fp) if (p.dropped) reasons[p.dropped]++
    const samplePath = fd[0]?.path ?? fp.find((p) => p.path.length > 1)?.path ?? []
    return {
      flowId: f.id,
      className: f.className,
      sent: fp.length,
      delivered: fd.length,
      dropped: fp.length - fd.length,
      deliveryRatePercent: fp.length ? r1((fd.length / fp.length) * 100) : 0,
      latencyMeanMs: fl.length ? r1(fl.reduce((a, b) => a + b, 0) / fl.length) : 0,
      latencyP95Ms: r1(percentile(fl, 0.95)),
      jitterMs: r1(jitter(fl)),
      pathHops: samplePath.length - 1,
      path: samplePath,
      dropReasons: reasons,
    }
  })

  const queueDelays = delivered.map((p) => p.queueDelayMs)
  const edgeLoadsFinal = [...edgeLoads.values()]
  const maxEdgeLoad = edgeLoadsFinal.length ? Math.max(...edgeLoadsFinal) : 0

  const metrics: SimMetrics = {
    sent: measured.length,
    delivered: delivered.length,
    dropped: measured.length - delivered.length,
    deliveryRatePercent: measured.length ? r1((delivered.length / measured.length) * 100) : 0,
    throughputPacketsPerSecond: window > 0 ? r1((delivered.length * 1000) / window) : 0,
    latencyMeanMs: latencies.length ? r1(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    latencyP50Ms: r1(percentile(latencies, 0.5)),
    latencyP95Ms: r1(percentile(latencies, 0.95)),
    latencyP99Ms: r1(percentile(latencies, 0.99)),
    jitterMs: r1(jitter(latencies)),
    meanQueueDelayMs: queueDelays.length ? r1(queueDelays.reduce((a, b) => a + b, 0) / queueDelays.length) : 0,
    queueDelayP95Ms: r1(percentile(queueDelays.sort((a, b) => a - b), 0.95)),
    peakQueueDepth: queues.size ? Math.max(...[...queues.values()].map((q) => q.peakDepth)) : 0,
    jainFairnessIndex: r1(jainIndex(flowMetrics.map((f) => f.deliveryRatePercent)) * 1000) / 1000,
    linkLoadJainIndex: r1(jainIndex(edgeLoadsFinal) * 1000) / 1000,
    droppedByReason: dropBy,
    convergenceTimeMs:
      firstDeliveryAfterDetect !== null && detectTime !== null ? r1(firstDeliveryAfterDetect - (detectTime - (params.detectionDelayMs ?? 40))) : null,
    maxEdgeLoad: r1(maxEdgeLoad * 100) / 100,
    flowMetrics,
  }

  return { seed, metrics, training }
}
