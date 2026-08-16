import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runExperiment } from '@/lib/sim'
import type { ExperimentParams } from '@/lib/sim/types'

// POST /api/sim/run - 执行组网仿真实验并持久化（完全可复现：同参数同结果）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const params: ExperimentParams = {
      topology: ['ring', 'spineleaf', 'mesh'].includes(body.topology) ? body.topology : 'ring',
      algorithm: ['dijkstra', 'loadaware', 'qlearning'].includes(body.algorithm) ? body.algorithm : 'dijkstra',
      seed: Number.isFinite(body.seed) ? Math.floor(body.seed) : 20260727,
      runs: Number.isFinite(body.runs) ? Math.min(20, Math.max(1, Math.floor(body.runs))) : 1,
      nodeCount: Number.isFinite(body.nodeCount) ? body.nodeCount : undefined,
      spineCount: Number.isFinite(body.spineCount) ? body.spineCount : undefined,
      leafCount: Number.isFinite(body.leafCount) ? body.leafCount : undefined,
      source: typeof body.source === 'string' && body.source ? body.source : undefined,
      destination: typeof body.destination === 'string' && body.destination ? body.destination : undefined,
      queueCapacityPackets: Number.isFinite(body.queueCapacityPackets) ? body.queueCapacityPackets : undefined,
      scheduler: body.scheduler === 'priority' ? 'priority' : 'fifo',
      discipline: body.discipline === 'red' ? 'red' : 'droptail',
      red: body.red && typeof body.red === 'object' ? body.red : undefined,
      failureAtMs: Number.isFinite(body.failureAtMs) ? body.failureAtMs : 0,
      detectionDelayMs: Number.isFinite(body.detectionDelayMs) ? body.detectionDelayMs : 40,
      qlearning: body.qlearning && typeof body.qlearning === 'object' ? body.qlearning : undefined,
    }

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

    return NextResponse.json({ runId: saved.id, createdAt: saved.createdAt, ...result })
  } catch (e) {
    return NextResponse.json({ error: '请求无效: ' + (e as Error).message }, { status: 400 })
  }
}
