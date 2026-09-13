import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getScenarioTemplate, SCENARIO_TEMPLATES, type ScenarioType } from '@/lib/inet/scenarios'
import { validateScenario, ScenarioValidationError } from '@/lib/inet/validation'
import { InetRunner } from '@/lib/inet/runner'
import { validateManifest, createManifest, type InetManifest } from '@/lib/inet/manifest'
import path from 'node:path'

export async function GET(request: Request) {
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('limit') ?? 30) || 30))
  const runs = await db.inetRun.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { scenario: { select: { name: true, scenarioType: true } } } })
  return NextResponse.json(runs)
}

export async function POST(request: Request) {
  try {
    const body = await request.json(); const type = body?.scenarioType as ScenarioType
    if (!type || !SCENARIO_TEMPLATES[type]) return NextResponse.json({ error: '不支持的 INET 场景类型' }, { status: 400 })
    const parameters = body.parameters ?? getScenarioTemplate(type).parameters
    validateScenario(type, parameters)
    const scenario = await db.inetScenario.create({ data: { name: body.name ?? getScenarioTemplate(type).name, scenarioType: type, description: getScenarioTemplate(type).description, parameters: JSON.stringify(parameters), manifest: JSON.stringify(body.manifest ?? {}) } })
    const run = await db.inetRun.create({ data: { scenarioId: scenario.id, status: 'queued', parameters: JSON.stringify(parameters) } })

    // 提交即执行：旧实现只写 queued，没有消费者，导致永远排队。
    // manifest 缺失或依赖不可用时也会明确落为 failed，而不是假装排队。
    const manifest = createManifest((body.manifest ?? {}) as Partial<InetManifest>)
    const diagnostics = validateManifest(manifest)
    if (diagnostics.length > 0) {
      await db.inetRun.update({ where: { id: run.id }, data: { status: 'failed', error: diagnostics.map((d) => d.message).join('；') } })
      return NextResponse.json({ runId: run.id, scenarioId: scenario.id, status: 'failed', error: diagnostics.map((d) => d.message).join('；') }, { status: 201 })
    }

    void (async () => {
      const started = await db.inetRun.update({ where: { id: run.id }, data: { status: 'running' } })
      void started
      try {
        const outputDir = path.join(manifest.resultDir, `run-${run.id}`)
        const result = await new InetRunner().run({ manifest, parameters: parameters as Record<string, string | number | boolean>, outputDir })
        await db.inetRun.update({
          where: { id: run.id },
          data: {
            status: result.status,
            metrics: JSON.stringify(result.result),
            artifactHash: result.artifactHash,
            error: result.status === 'succeeded' ? '' : result.stderr.slice(-4000),
          },
        })
      } catch (error) {
        await db.inetRun.update({ where: { id: run.id }, data: { status: 'failed', error: (error as Error).message } }).catch(() => undefined)
      }
    })()

    return NextResponse.json({ runId: run.id, scenarioId: scenario.id, status: 'running' }, { status: 201 })
  } catch (e) { if (e instanceof ScenarioValidationError) return NextResponse.json({ error: e.message, issues: e.issues }, { status: 400 }); return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
}
