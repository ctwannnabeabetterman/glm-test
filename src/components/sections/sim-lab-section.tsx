'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SectionHeader } from './papers-section'
import { TOPOLOGY_META } from '@/lib/sim'
import type { Algorithm, BatchResult, TopologyId } from '@/lib/sim/types'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar } from 'recharts'
import { Network, Play, Loader2, Trash2, Repeat, GitCompare, History, FlaskConical, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

const ALGORITHMS: { id: Algorithm; name: string; desc: string }[] = [
  { id: 'dijkstra', name: 'Dijkstra 最短时延', desc: '经典最短路径基线' },
  { id: 'loadaware', name: '负载感知路由', desc: '代价函数计入链路拥塞' },
  { id: 'qlearning', name: 'Q-Learning 路由', desc: '强化学习，状态含目的地' },
]

interface HistoryItem {
  id: string
  label: string
  topology: string
  algorithm: string
  seed: number
  metrics: string
  status: string
  createdAt: string
}

export function SimLabSection() {
  const [topology, setTopology] = useState<TopologyId>('mesh')
  const [algorithm, setAlgorithm] = useState<Algorithm>('qlearning')
  const [seed, setSeed] = useState(20260727)
  const [runs, setRuns] = useState(1)
  const [nodeCount, setNodeCount] = useState(12)
  const [spineCount, setSpineCount] = useState(4)
  const [leafCount, setLeafCount] = useState(6)
  const [queueCap, setQueueCap] = useState(8)
  const [scheduler, setScheduler] = useState<'fifo' | 'priority'>('fifo')
  const [discipline, setDiscipline] = useState<'droptail' | 'red'>('droptail')
  const [injectFailure, setInjectFailure] = useState(false)
  const [episodes, setEpisodes] = useState(300)
  const [label, setLabel] = useState('')

  const [running, setRunning] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [compareResults, setCompareResults] = useState<BatchResult[] | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  const loadHistory = useCallback(async () => {
    const res = await fetch('/api/sim/runs?limit=20')
    setHistory(await res.json())
  }, [])

  useEffect(() => {
    // 挂载时加载实验历史；loadHistory 内唯一 setState 位于 await fetch 之后，
    // 属合法的「取数挂载」模式，非同步级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHistory()
  }, [loadHistory])

  const buildParams = (algo: Algorithm) => ({
    topology,
    algorithm: algo,
    seed,
    runs,
    nodeCount,
    spineCount,
    leafCount,
    queueCapacityPackets: queueCap,
    scheduler,
    discipline,
    failureAtMs: injectFailure ? 300 : 0,
    detectionDelayMs: 40,
    qlearning: { episodes },
    label: label || `${TOPOLOGY_META.find((t) => t.id === topology)?.name} · ${ALGORITHMS.find((a) => a.id === algo)?.name}`,
  })

  const run = async (algo?: Algorithm) => {
    setRunning(true)
    setCompareResults(null)
    try {
      const res = await fetch('/api/sim/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildParams(algo ?? algorithm)),
      })
      const data: BatchResult & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      toast.success(`实验完成：${data.runs.length} 次运行 · ${data.durationMs}ms`)
      loadHistory()
    } catch (e) {
      toast.error('仿真失败：' + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const compareAll = async () => {
    setComparing(true)
    try {
      const results: BatchResult[] = []
      for (const algo of ALGORITHMS) {
        const res = await fetch('/api/sim/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildParams(algo.id)),
        })
        const data: BatchResult & { error?: string } = await res.json()
        if (!res.ok) throw new Error(data.error)
        results.push(data)
      }
      setCompareResults(results)
      setResult(results.find((r) => r.params.algorithm === algorithm) ?? results[0])
      loadHistory()
      toast.success('三种算法对比完成')
    } catch (e) {
      toast.error('对比失败：' + (e as Error).message)
    } finally {
      setComparing(false)
    }
  }

  const deleteRun = async (id: string) => {
    await fetch(`/api/sim/runs?id=${id}`, { method: 'DELETE' })
    loadHistory()
  }

  const m = result?.runs[0]?.metrics
  const training = result?.runs[0]?.training

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Network}
        title="组网仿真实验"
        desc="种子化离散事件仿真引擎：Dijkstra / 负载感知 / Q-Learning 三种路由在环形骨干、Spine-Leaf、Mesh 拓扑下的可复现对比实验"
      />

      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        可复现保证：相同参数与种子在任意机器上产生字节级一致的结果（mulberry32 + FNV-1a 流派生），实验记录自动持久化到 SQLite
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* 参数面板 */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" /> 实验参数
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>网络拓扑</Label>
              <Select value={topology} onValueChange={(v) => setTopology(v as TopologyId)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TOPOLOGY_META.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{TOPOLOGY_META.find((t) => t.id === topology)?.description}</p>
            </div>

            <div className="space-y-2">
              <Label>路由算法</Label>
              <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as Algorithm)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALGORITHMS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ALGORITHMS.find((a) => a.id === algorithm)?.desc}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>随机种子</Label>
                <Input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>批量次数（多种子）</Label>
                <Input type="number" min={1} max={20} value={runs} onChange={(e) => setRuns(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
              </div>
            </div>

            {topology === 'spineleaf' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Spine 数量</Label>
                  <Input type="number" min={2} max={8} value={spineCount} onChange={(e) => setSpineCount(Number(e.target.value) || 4)} />
                </div>
                <div className="space-y-2">
                  <Label>Leaf 数量</Label>
                  <Input type="number" min={2} max={16} value={leafCount} onChange={(e) => setLeafCount(Number(e.target.value) || 6)} />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>节点数量</Label>
                <Input type="number" min={topology === 'ring' ? 6 : 8} max={topology === 'ring' ? 12 : 24} value={nodeCount} onChange={(e) => setNodeCount(Number(e.target.value) || 12)} />
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>队列容量</Label>
                <Input type="number" min={1} max={64} value={queueCap} onChange={(e) => setQueueCap(Number(e.target.value) || 8)} />
              </div>
              <div className="space-y-2">
                <Label>调度器</Label>
                <Select value={scheduler} onValueChange={(v) => setScheduler(v as 'fifo' | 'priority')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fifo">FIFO</SelectItem>
                    <SelectItem value="priority">严格优先级</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>队列策略</Label>
                <Select value={discipline} onValueChange={(v) => setDiscipline(v as 'droptail' | 'red')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="droptail">Drop-Tail</SelectItem>
                    <SelectItem value="red">RED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {algorithm === 'qlearning' && (
              <div className="space-y-2">
                <Label>训练 Episode 数</Label>
                <Input type="number" min={50} max={2000} value={episodes} onChange={(e) => setEpisodes(Math.min(2000, Math.max(50, Number(e.target.value) || 300)))} />
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="inject-failure">链路故障注入</Label>
                <p className="text-xs text-muted-foreground">t=300ms 断开主流首跳链路，检测后重路由</p>
              </div>
              <Switch id="inject-failure" checked={injectFailure} onCheckedChange={setInjectFailure} />
            </div>

            <div className="space-y-2">
              <Label>实验备注（可选）</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如：mesh-12节点-拥塞对比-第1组" />
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => run()} disabled={running || comparing} className="flex-1">
                {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                运行实验
              </Button>
              <Button variant="outline" onClick={compareAll} disabled={running || comparing}>
                {comparing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <GitCompare className="mr-1 h-4 w-4" />}
                三算法对比
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 结果区 */}
        <div className="space-y-6">
          {!result && !running && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <Network className="h-10 w-10 opacity-30" />
                <p>设置参数后点击「运行实验」</p>
                <p className="text-xs">默认场景：3 条业务流（URLLC/eMBB/mMTC）× 20 包，预热 3 包不计数</p>
              </CardContent>
            </Card>
          )}

          {m && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard title="交付率" value={`${m.deliveryRatePercent}%`} sub={`${m.delivered}/${m.sent} 包`} />
                <MetricCard title="吞吐量" value={`${m.throughputPacketsPerSecond}`} sub="包/秒" />
                <MetricCard title="时延 P95" value={`${m.latencyP95Ms} ms`} sub={`P99 ${m.latencyP99Ms}ms · 抖动 ${m.jitterMs}ms`} />
                <MetricCard
                  title="公平性 Jain"
                  value={m.jainFairnessIndex.toFixed(3)}
                  sub={`链路负载 Jain ${m.linkLoadJainIndex.toFixed(3)}`}
                />
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">丢包原因分解</CardTitle>
                    <CardDescription>
                      {result!.topologySummary.nodeCount} 节点 · {result!.topologySummary.edgeCount} 链路 · 种子 {result!.runs[0].seed}
                      {m.convergenceTimeMs !== null && ` · 故障收敛 ${m.convergenceTimeMs}ms`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={Object.entries(m.droppedByReason).filter(([, v]) => v > 0).map(([k, v]) => ({ reason: k, count: v }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="reason" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">各流指标</CardTitle>
                    <CardDescription>预热包已剔除</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2">流</th>
                          <th className="pb-2">交付率</th>
                          <th className="pb-2">P95</th>
                          <th className="pb-2">跳数</th>
                          <th className="pb-2">路径</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.flowMetrics.map((f) => (
                          <tr key={f.flowId} className="border-b last:border-0">
                            <td className="py-2"><Badge variant="outline">{f.className}</Badge></td>
                            <td className="py-2">{f.deliveryRatePercent}%</td>
                            <td className="py-2">{f.latencyP95Ms}ms</td>
                            <td className="py-2">{f.pathHops}</td>
                            <td className="py-2 font-mono text-xs text-muted-foreground">{f.path.join('→')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>

              {result!.aggregate && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">多种子汇总（{result!.runs.length} 次运行，均值 ± 标准差）</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 text-sm">
                    {(
                      [
                        ['交付率 %', result!.aggregate.deliveryRatePercent],
                        ['吞吐量 pkt/s', result!.aggregate.throughputPacketsPerSecond],
                        ['时延 P95 ms', result!.aggregate.latencyP95Ms],
                        ['抖动 ms', result!.aggregate.jitterMs],
                        ['流公平 Jain', result!.aggregate.jainFairnessIndex],
                        ['链路负载 Jain', result!.aggregate.linkLoadJainIndex],
                      ] as const
                    ).map(([name, stat]) => (
                      <div key={name} className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">{name}</p>
                        <p className="font-mono">{stat.mean} ± {stat.std}</p>
                        <p className="text-xs text-muted-foreground">[{stat.min}, {stat.max}]</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {training && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Q-Learning 训练曲线</CardTitle>
                    <CardDescription>
                      {training.episodes} episodes · 成功率 {(training.successRate * 100).toFixed(1)}% · 最终 ε {training.finalEpsilon}
                      {training.fellBackToDijkstra && ' · ⚠ 贪心策略未找到路径，已回退 Dijkstra（如实记录）'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={training.curve}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="episode" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Line yAxisId="l" type="monotone" dataKey="totalReward" name="Episode 累计奖励" stroke="#10b981" dot={false} />
                        <Line yAxisId="l" type="monotone" dataKey="greedyPathCost" name="贪心路径代价" stroke="#f59e0b" dot={false} />
                        <Line yAxisId="r" type="monotone" dataKey="epsilon" name="ε" stroke="#6366f1" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {compareResults && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">三种算法对比（同拓扑同种子）</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2">算法</th>
                          <th className="pb-2">交付率</th>
                          <th className="pb-2">P95</th>
                          <th className="pb-2">抖动</th>
                          <th className="pb-2">流公平</th>
                          <th className="pb-2">链路负载公平</th>
                          <th className="pb-2">峰值队列</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compareResults.map((r) => {
                          const mm = r.runs[0].metrics
                          return (
                            <tr key={r.params.algorithm} className="border-b last:border-0">
                              <td className="py-2">{ALGORITHMS.find((a) => a.id === r.params.algorithm)?.name}</td>
                              <td className="py-2 font-mono">{mm.deliveryRatePercent}%</td>
                              <td className="py-2 font-mono">{mm.latencyP95Ms}ms</td>
                              <td className="py-2 font-mono">{mm.jitterMs}ms</td>
                              <td className="py-2 font-mono">{mm.jainFairnessIndex.toFixed(3)}</td>
                              <td className="py-2 font-mono">{mm.linkLoadJainIndex.toFixed(3)}</td>
                              <td className="py-2 font-mono">{mm.peakQueueDepth}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      {/* 历史记录 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> 实验历史
            <Badge variant="secondary">{history.length}</Badge>
          </CardTitle>
          <CardDescription>所有实验参数与结果持久化于 SQLite，随时可查、可复现</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无实验记录</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => {
                let metrics: Record<string, unknown> = {}
                try { metrics = JSON.parse(h.metrics) } catch { /* failed run */ }
                // 多种子运行的 metrics 存的是 AggStat（{mean,std,min,max}），单种子是数字
                const rawDelivery = metrics.deliveryRatePercent
                const delivery = typeof rawDelivery === 'number' ? rawDelivery : (rawDelivery as { mean?: number } | undefined)?.mean
                return (
                  <div key={h.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{h.label || `${h.topology} · ${h.algorithm}`}</span>
                      <Badge variant="outline" className="shrink-0">{h.algorithm}</Badge>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">seed {h.seed}</span>
                      {h.status !== 'done' ? (
                        <Badge variant="destructive" className="shrink-0">失败</Badge>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">交付 {delivery !== undefined ? `${Math.round(delivery * 10) / 10}` : '-'}%</span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleString('zh-CN')}</span>
                    <Button variant="ghost" size="icon" onClick={() => deleteRun(h.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MetricCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}
