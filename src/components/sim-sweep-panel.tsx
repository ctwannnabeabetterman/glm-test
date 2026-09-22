'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell } from 'recharts'
import { Activity, Download, Loader2, Sparkles, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { downloadViaPost } from '@/lib/download'
import {
  SWEEP_METRICS,
  SWEEP_VARS,
  buildSweepPlan,
  getSweepVarMeta,
  type SweepMetric,
  type SweepSeries,
  type RecentActivity,
} from '@/lib/sim/sweep'
import type { Algorithm, TopologyId } from '@/lib/sim/types'
import { cn } from '@/lib/utils'

const ALGO_LABEL: Record<string, string> = {
  dijkstra: 'Dijkstra',
  loadaware: '负载感知',
  qlearning: 'Q-Learning',
}
const ALGO_COLOR: Record<string, string> = {
  dijkstra: '#3b82f6',
  loadaware: '#10b981',
  qlearning: '#f59e0b',
}
const METRIC_HINT: Record<string, string> = Object.fromEntries(SWEEP_METRICS.map((m) => [m.id, m.hint ?? '']))

interface SweepResponse {
  ok?: boolean
  error?: string
  axis?: { var: string; label: string; unit: string; values: number[] }
  algorithms?: Algorithm[]
  seedRuns?: number
  metric?: SweepMetric
  axisLabel?: string
  series?: SweepSeries[]
  seriesByMetric?: Record<string, SweepSeries[]>
  cells?: number
  failures?: number
  totalRuns?: number
  durationMs?: number
}

/**
 * 参数扫描面板。
 *
 * 为什么放在仿真页而不是单独一页：扫描用的**基础参数就是上面那块「实验参数」**，
 * 用户想扫的往往是「我现在这套配置，把队列容量从 16 加到 128 会怎样」。
 * 所以这里不重复造参数表单，只让他选「扫哪个轴、扫多大范围、比哪几种算法」。
 *
 * 两个刻意的设计：
 *  1. **点之前就把规模算清楚**（`buildSweepPlan` 是纯函数，前端直接算）：
 *     会显示「5 个点 × 2 算法 × 3 种子 = 30 次仿真」，超上限时按钮直接禁用并说明怎么缩 ——
 *     而不是点下去等几分钟再报错。
 *  2. **所有指标的曲线一次算好**（后端 `seriesByMetric`）：切换「看交付率还是看 P95 时延」
 *     是瞬间的，不必重跑矩阵。
 */
export function SimSweepPanel({
  topology,
  baseParams,
  onFinished,
}: {
  topology: TopologyId
  /** 沿用主面板当前配置（含 seed / runs 之外的全部参数） */
  baseParams: Record<string, unknown>
  onFinished: () => void
}) {
  const [sweepVar, setSweepVar] = useState('queueCapacityPackets')
  const meta = getSweepVarMeta(sweepVar) ?? SWEEP_VARS[0]
  const [from, setFrom] = useState(meta.defaultFrom)
  const [to, setTo] = useState(meta.defaultTo)
  const [step, setStep] = useState(meta.defaultStep)
  const [algorithms, setAlgorithms] = useState<Algorithm[]>(['dijkstra'])
  const [seedRuns, setSeedRuns] = useState(1)
  const [metric, setMetric] = useState<SweepMetric>('deliveryRatePercent')

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SweepResponse | null>(null)

  // 换轴时把范围重置成该轴的默认值 —— 否则「队列容量 16→128」的范围会被带到「故障注入 0→5000」上
  const changeVar = (v: string) => {
    const m = getSweepVarMeta(v)
    if (!m) return
    setSweepVar(v)
    setFrom(m.defaultFrom)
    setTo(m.defaultTo)
    setStep(m.defaultStep)
  }

  const plan = useMemo(
    () => buildSweepPlan({ topology, sweepVar, from, to, step, algorithms, seedRuns }),
    [topology, sweepVar, from, to, step, algorithms, seedRuns],
  )

  const run = async () => {
    if (plan.error) {
      toast.error(plan.error)
      return
    }
    setRunning(true)
    try {
      const res = await fetch('/api/sim/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...baseParams,
          topology,
          algorithms,
          seedRuns,
          sweepVar,
          from,
          to,
          step,
          metric,
        }),
      })
      const data: SweepResponse = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || '扫描失败')
      setResult(data)
      toast.success(
        `扫描完成：${data.cells} 格 · 共 ${data.totalRuns} 次仿真 · ${Math.round((data.durationMs ?? 0) / 1000)}s` +
          (data.failures ? ` · ${data.failures} 格失败（已记进历史）` : ''),
      )
      onFinished()
    } catch (e) {
      toast.error('扫描失败：' + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const exportCsv = async () => {
    const series = result?.seriesByMetric?.[metric]
    if (!series || series.length === 0) {
      toast.error('没有可导出的结果，先跑一次扫描')
      return
    }
    try {
      const ok = await downloadViaPost(
        '/api/sim/sweep/export',
        { series, metric, xLabel: result?.axisLabel || '参数值' },
        `参数扫描-${metric}.csv`,
      )
      if (ok) toast.success('CSV 已导出（表头含均值/标准差/极值/样本数，可直接进论文）')
    } catch (e) {
      toast.error('导出失败：' + (e as Error).message)
    }
  }

  const chartSeries = result?.seriesByMetric?.[metric] ?? result?.series ?? []
  // recharts 需要「一行一个 x、每列一个算法」的宽表
  const chartData = useMemo(() => {
    if (chartSeries.length === 0) return []
    const xs = [...new Set(chartSeries.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b)
    return xs.map((x) => {
      const row: Record<string, number | string> = { x }
      for (const s of chartSeries) {
        const p = s.points.find((q) => q.x === x)
        if (p) {
          row[s.algorithm] = p.mean
          row[`${s.algorithm}__std`] = p.std
          row[`${s.algorithm}__n`] = p.n
        }
      }
      return row
    })
  }, [chartSeries])

  const metricUnit = SWEEP_METRICS.find((m) => m.id === metric)?.unit ?? ''

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" /> 参数扫描
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            轴 × 算法 × 多种子，一次跑完并画成曲线（引擎确定性，同参数必然同结果）
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs">扫描轴</Label>
            <Select value={sweepVar} onValueChange={changeVar}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SWEEP_VARS.map((v) => (
                  <SelectItem key={v.id} value={v.id} disabled={v.exceptTopology?.includes(topology)}>
                    {v.label}
                    {v.exceptTopology?.includes(topology) ? '（当前拓扑不适用）' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{meta.hint}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([['起点', from, setFrom], ['终点', to, setTo], ['步长', step, setStep]] as const).map(([lab, val, set]) => (
              <div key={lab}>
                <Label className="text-xs">{lab}</Label>
                <Input
                  type="number"
                  className="mt-1 h-8 text-xs"
                  value={val}
                  aria-label={lab}
                  onChange={(e) => set(Number(e.target.value))}
                />
              </div>
            ))}
          </div>
          <div>
            <Label className="text-xs">对比算法（可多选）</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(['dijkstra', 'loadaware', 'qlearning'] as Algorithm[]).map((a) => {
                const on = algorithms.includes(a)
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() =>
                      setAlgorithms((prev) => (on ? prev.filter((x) => x !== a) : [...prev, a]))
                    }
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11px] transition-colors',
                      on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                    )}
                  >
                    {ALGO_LABEL[a]}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">每点重复次数</Label>
              <Input
                type="number"
                min={1}
                max={10}
                className="mt-1 h-8 text-xs"
                aria-label="每点重复次数"
                value={seedRuns}
                onChange={(e) => setSeedRuns(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">&gt;1 时给出均值±标准差</p>
            </div>
            <div>
              <Label className="text-xs">看哪个指标</Label>
              <Select value={metric} onValueChange={(v) => setMetric(v as SweepMetric)}>
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SWEEP_METRICS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                      {m.unit ? `（${m.unit}）` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={run} disabled={running || !!plan.error}>
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> 扫描中（{plan.totalRuns} 次仿真）...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> 开始扫描
              </>
            )}
          </Button>
          <span className={cn('text-[11px]', plan.error ? 'text-destructive' : 'text-muted-foreground')}>
            {plan.error
              ? plan.error
              : `预计 ${plan.values.length} 个取值点 × ${plan.algorithms.length} 算法 × ${plan.seedRuns} 种子 = ${plan.totalRuns} 次仿真`}
          </span>
          {result && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> 导出 CSV
            </Button>
          )}
        </div>

        {result?.failures ? (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              有 {result.failures} 格没跑成（图上该点会缺值，失败详情已写进实验历史）——
              半张图 + 明确的失败标记，比整批报错更便于定位。
            </span>
          </div>
        ) : null}

        {result && chartData.length > 0 && (
          <div className="space-y-2">
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="x" fontSize={11} label={{ value: result.axisLabel || '', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                  <YAxis fontSize={11} label={{ value: metricUnit, angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      const key = String(name)
                      return [`${value}${metricUnit}`, ALGO_LABEL[key] ?? key]
                    }}
                    labelFormatter={(x) => `${result.axis?.label ?? '参数'} = ${x}${result.axis?.unit ?? ''}`}
                  />
                  <Legend formatter={(v) => ALGO_LABEL[String(v)] ?? String(v)} />
                  {chartSeries.map((s) => (
                    <Line
                      key={s.algorithm}
                      type="monotone"
                      dataKey={s.algorithm}
                      stroke={ALGO_COLOR[s.algorithm] ?? '#6b7280'}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground">
              悬停看均值；均值的离散程度（标准差）与样本数见下表。{METRIC_HINT[metric] || ''}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-1.5 text-left">{result.axis?.label ?? '参数'}</th>
                    <th className="py-1.5 text-left">算法</th>
                    <th className="py-1.5 text-right">均值</th>
                    <th className="py-1.5 text-right">标准差</th>
                    <th className="py-1.5 text-right">最小</th>
                    <th className="py-1.5 text-right">最大</th>
                    <th className="py-1.5 text-right">样本</th>
                    <th className="py-1.5 text-right">失败</th>
                  </tr>
                </thead>
                <tbody>
                  {chartSeries.flatMap((s) =>
                    s.points.map((p) => (
                      <tr key={`${s.algorithm}-${p.x}`} className="border-b border-border/40">
                        <td className="py-1.5">{p.x}</td>
                        <td className="py-1.5">
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full" style={{ background: ALGO_COLOR[s.algorithm] }} />
                            {ALGO_LABEL[s.algorithm] ?? s.algorithm}
                          </span>
                        </td>
                        <td className="py-1.5 text-right font-medium tabular-nums">{p.mean}{metricUnit}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">±{p.std}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{p.min}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{p.max}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.n}</td>
                        <td className={cn('py-1.5 text-right tabular-nums', p.failures ? 'text-destructive' : 'text-muted-foreground')}>
                          {p.failures}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
