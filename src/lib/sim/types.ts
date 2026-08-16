/** 组网仿真类型定义 —— 纯类型，前后端共用 */

export type Algorithm = 'dijkstra' | 'loadaware' | 'qlearning'
export type TopologyId = 'ring' | 'spineleaf' | 'mesh'
export type Scheduler = 'fifo' | 'priority'
export type QueueDiscipline = 'droptail' | 'red'

export interface SimNode {
  id: string
  role: 'core' | 'spine' | 'leaf' | 'host' | 'gateway' | 'mesh'
  /** 节点处理时延（ms/包） */
  procDelayMs: number
  /** 节点容量（并发处理能力，仅作路由代价惩罚项） */
  capacity: number
  /** 节点可靠性 0-1 */
  reliability: number
}

export interface SimEdge {
  id: string
  from: string
  to: string
  /** 链路传播时延（ms），同时作为路由基础代价 */
  propagationMs: number
  /** 链路带宽（Mb/s），决定发包服务时间 */
  bandwidthMbps: number
  /** 链路误码丢包率 0-1 */
  lossRate: number
}

export interface Topology {
  id: TopologyId
  nodes: SimNode[]
  edges: SimEdge[]
  /** 推荐实验源/宿对 */
  defaultPair: { source: string; destination: string }
  description: string
}

/** 业务流定义 */
export interface TrafficFlow {
  id: string
  className: 'urllc' | 'embb' | 'mmtc'
  /** 数值越小优先级越高 */
  priority: number
  source: string
  destination: string
  packetCount: number
  /** 预热包数（统计时剔除，消除冷启动偏置） */
  warmupPackets: number
  packetIntervalMs: number
  startAtMs: number
  /** 包大小（Kb） */
  packetSizeKb: number
}

export interface ExperimentParams {
  topology: TopologyId
  algorithm: Algorithm
  seed: number
  /** 拓扑规模参数：ring/mesh 为节点数，spineleaf 为 [spine数, leaf数] */
  nodeCount?: number
  spineCount?: number
  leafCount?: number
  source?: string
  destination?: string
  /** 批量运行数（种子为 seed, seed+1, ...），>1 时输出均值±标准差 */
  runs?: number
  queueCapacityPackets?: number
  scheduler?: Scheduler
  discipline?: QueueDiscipline
  red?: { minThresholdPackets?: number; maxThresholdPackets?: number; maxDropProbability?: number; weight?: number }
  /** 链路故障注入：失败时刻（ms），0 表示不注入 */
  failureAtMs?: number
  detectionDelayMs?: number
  /** Q-Learning 训练参数 */
  qlearning?: {
    episodes?: number
    alpha?: number
    gamma?: number
    epsilon?: number
    epsilonMin?: number
    epsilonDecay?: number
  }
}

export type DropReason =
  | 'queue-full'
  | 'red-early-drop'
  | 'link-loss'
  | 'link-failure'
  | 'no-route'
  | 'congestion'

export interface FlowMetrics {
  flowId: string
  className: string
  sent: number
  delivered: number
  dropped: number
  deliveryRatePercent: number
  latencyMeanMs: number
  latencyP95Ms: number
  jitterMs: number
  pathHops: number
  path: string[]
  dropReasons: Record<DropReason, number>
}

export interface SimMetrics {
  sent: number
  delivered: number
  dropped: number
  deliveryRatePercent: number
  throughputPacketsPerSecond: number
  latencyMeanMs: number
  latencyP50Ms: number
  latencyP95Ms: number
  latencyP99Ms: number
  jitterMs: number
  meanQueueDelayMs: number
  queueDelayP95Ms: number
  peakQueueDepth: number
  /** 各流交付率的 Jain 公平指数 */
  jainFairnessIndex: number
  /** 各链路最终负载的 Jain 公平指数（负载均衡质量） */
  linkLoadJainIndex: number
  droppedByReason: Record<DropReason, number>
  convergenceTimeMs: number | null
  maxEdgeLoad: number
  flowMetrics: FlowMetrics[]
}

export interface QTrainingPoint {
  episode: number
  totalReward: number
  greedyPathCost: number
  epsilon: number
  success: boolean
}

export interface QTrainingReport {
  episodes: number
  finalEpsilon: number
  successRate: number
  /** 训练曲线（每 episodes/50 采样一点，首尾必采） */
  curve: QTrainingPoint[]
  /** 贪心策略最终是否得到可行路径（false 时回退 Dijkstra 并如实标注） */
  foundPath: boolean
  fellBackToDijkstra: boolean
}

export interface SingleRunResult {
  seed: number
  metrics: SimMetrics
  training?: QTrainingReport
}

export interface BatchResult {
  params: ExperimentParams
  runs: SingleRunResult[]
  /** runs>1 时的关键指标汇总（均值 ± 标准差） */
  aggregate?: {
    deliveryRatePercent: AggStat
    throughputPacketsPerSecond: AggStat
    latencyP95Ms: AggStat
    jitterMs: AggStat
    jainFairnessIndex: AggStat
    linkLoadJainIndex: AggStat
  }
  topologySummary: { nodeCount: number; edgeCount: number; topology: TopologyId }
  durationMs: number
}

export interface AggStat {
  mean: number
  std: number
  min: number
  max: number
}
