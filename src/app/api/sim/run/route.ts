import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runExperiment } from '@/lib/sim'
import { parseExperimentParams } from '@/lib/sim/params'
import type { ExperimentParams } from '@/lib/sim/types'
import { recordActivity } from '@/lib/activity'

// POST /api/sim/run - 执行组网仿真实验并持久化（完全可复现：同参数同结果）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    // 参数解析统一走 lib/sim/params.ts —— 参数扫描那条路由共用同一份默认值与兜底规则
    const params: ExperimentParams = parseExperimentParams(body)

    let result
    try {
      result = runExperiment(params)
    } catch (e) {
      const saved = await db.simRun.create({
        data: {
          topology: params.topology,
          algorithm: params.algorithm,
          seed: params.seed,
          params: JSON.stringify(params),
          status: 'failed',
          error: (e as Error).message,
        },
      })
      return NextResponse.json({ error: '仿真失败: ' + (e as Error).message, runId: saved.id }, { status: 500 })
    }

    const primary = result.runs[0]
    const saved = await db.simRun.create({
      data: {
        label: typeof body.label === 'string' ? body.label.slice(0, 100) : '',
        topology: params.topology,
        algorithm: params.algorithm,
        seed: params.seed,
        params: JSON.stringify(params),
        metrics: JSON.stringify(result.aggregate ?? primary.metrics),
        detail: JSON.stringify({ runs: result.runs, topologySummary: result.topologySummary }),
        status: 'done',
      },
    })

    void recordActivity({ module: 'sim', action: 'run', title: `跑了一次仿真（${params.topology} · ${params.algorithm}）`, refId: saved.id })
    return NextResponse.json({ runId: saved.id, createdAt: saved.createdAt, ...result })
  } catch (e) {
    return NextResponse.json({ error: '请求无效: ' + (e as Error).message }, { status: 400 })
  }
}
