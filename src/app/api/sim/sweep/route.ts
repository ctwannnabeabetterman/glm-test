import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runExperiment } from '@/lib/sim'
import { isAlgorithm, parseExperimentParams } from '@/lib/sim/params'
import {
  SWEEP_METRICS,
  buildSweepPlan,
  summarizeSweep,
  type SweepCell,
  type SweepMetric,
} from '@/lib/sim/sweep'
import type { Algorithm, ExperimentParams, SingleRunResult } from '@/lib/sim/types'
import { recordActivity } from '@/lib/activity'

/**
 * POST /api/sim/sweep —— 参数扫描：一次把「参数轴 × 算法 × 多种子」的矩阵跑完。
 *
 * 为什么值得单开一条路由：引擎是**确定性**的（种子化 + FNV-1a 派生），批量跑天生安全；
 * 而科研上真正要的是**曲线**（交付率随节点数怎么变、队列容量加到多少就饱和），
 * 现状只能手点 N 次「运行实验」再抄数字。
 *
 * 三处刻意的取舍：
 *  1. **规模上限**（轴 ≤12 点、总运行 ≤120 次）在 `buildSweepPlan` 里判，超了直接 400 ——
 *     一个请求把服务端占住几分钟，比报错难处理得多；
 *  2. **逐格落库**（每个「取值点 × 算法」一条 SimRun，label 带「扫描」前缀）——
 *     这样「实验历史」和「近 7 天运行记录」都能看到它，不用为扫描单独造一套历史；
 *     多写了一行 `label` 前缀的约定，但省掉一整套新表。
 *  3. **单格失败不中断**：某格引擎抛错就记 `status: 'failed'` 继续跑下一格，
 *     最后把失败数如实报出来 —— 半张图 + 明确的失败标记，好过整批失败只给一句「仿真失败」。
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch (e) {
    return NextResponse.json({ error: '请求无效: ' + (e as Error).message }, { status: 400 })
  }

  const base: ExperimentParams = parseExperimentParams(body)
  const algorithms: Algorithm[] = Array.isArray(body.algorithms)
    ? (body.algorithms.filter(isAlgorithm) as Algorithm[])
    : [base.algorithm]

  const metric: SweepMetric = (SWEEP_METRICS.find((m) => m.id === body.metric)?.id ?? 'deliveryRatePercent') as SweepMetric

  const plan = buildSweepPlan({
    topology: base.topology,
    sweepVar: String(body.sweepVar ?? ''),
    from: Number(body.from),
    to: Number(body.to),
    step: Number(body.step),
    algorithms,
    seedRuns: Number(body.seedRuns ?? 1),
  })
  if (plan.error) {
    return NextResponse.json({ error: plan.error, plan: { values: plan.values, cells: plan.cells, totalRuns: plan.totalRuns } }, { status: 400 })
  }

  const started = Date.now()
  const cells: SweepCell[] = []
  const runIds: string[] = []

  for (const value of plan.values) {
    for (const algorithm of plan.algorithms) {
      // 关键：被扫的那个轴覆盖 base 里的同名字段，其余参数原样沿用当前界面配置
      const params: ExperimentParams = {
        ...base,
        algorithm,
        runs: plan.seedRuns,
        [plan.meta.id]: value,
      }
      let results: SingleRunResult[] = []
      let failure: string | undefined
      try {
        const batch = runExperiment(params)
        results = batch.runs
      } catch (e) {
        failure = (e as Error).message
      }

      const cell: SweepCell = {
        x: value,
        algorithm,
        metrics: results.map((r) => r.metrics),
        failures: failure ? plan.seedRuns : 0,
        error: failure,
      }
      cells.push(cell)

      try {
        const saved = await db.simRun.create({
          data: {
            label: `扫描：${plan.meta.label}=${value}${plan.meta.unit} · ${algorithm}`,
            topology: params.topology,
            algorithm,
            seed: params.seed,
            params: JSON.stringify({
              ...params,
              sweep: { var: plan.meta.id, value, from: Number(body.from), to: Number(body.to), step: Number(body.step), algorithms: plan.algorithms, seedRuns: plan.seedRuns },
            }),
            metrics: JSON.stringify(meanMetrics(results)),
            detail: JSON.stringify({ sweep: true, perRun: results.map((r) => ({ seed: r.seed, deliveryRatePercent: r.metrics.deliveryRatePercent })) }),
            status: failure ? 'failed' : 'done',
            error: failure ?? '',
          },
        })
        runIds.push(saved.id)
      } catch (e) {
        // 落库失败不该让整批扫描白跑：把错误记进该格，继续
        cell.error = `落库失败：${(e as Error).message}`
      }
    }
  }

  const series = summarizeSweep(cells, metric)
  // 一次把**所有**指标都算好返回：界面切换「看哪个指标」就不必重跑整个扫描
  // （重跑一次矩阵要几分钟，而数据本来就在手里）
  const seriesByMetric: Record<string, ReturnType<typeof summarizeSweep>> = {}
  for (const m of SWEEP_METRICS) seriesByMetric[m.id] = summarizeSweep(cells, m.id)

  const failures = cells.filter((c) => c.error).length
  const axisLabel = `${plan.meta.label}（${plan.meta.unit}）`

  void recordActivity({
    module: 'sim',
    action: 'run',
    title: `跑了参数扫描：${plan.meta.label} ${plan.values[0]}→${plan.values[plan.values.length - 1]} · ${plan.algorithms.length} 算法`,
    refId: runIds[0] ?? '',
    detail: `共 ${plan.totalRuns} 次仿真，失败 ${failures} 格`,
  })
  return NextResponse.json({
    ok: true,
    axis: { var: plan.meta.id, label: plan.meta.label, unit: plan.meta.unit, values: plan.values },
    algorithms: plan.algorithms,
    seedRuns: plan.seedRuns,
    metric,
    metricLabel: SWEEP_METRICS.find((m) => m.id === metric)?.label ?? metric,
    axisLabel,
    series,
    seriesByMetric,
    cells: cells.length,
    failures,
    totalRuns: plan.totalRuns,
    durationMs: Date.now() - started,
    runIds,
  })
}

/** 多种子下的「汇总指标」：逐指标取均值（只保留能转成数字的字段） */
function meanMetrics(runs: SingleRunResult[]): Record<string, number> {
  if (runs.length === 0) return {}
  const out: Record<string, number> = {}
  const keys = Object.keys(runs[0].metrics)
  for (const key of keys) {
    const vals = runs.map((r) => Number((r.metrics as unknown as Record<string, unknown>)[key])).filter((v) => Number.isFinite(v))
    if (vals.length) out[key] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
  }
  return out
}
