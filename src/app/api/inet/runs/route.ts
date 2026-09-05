import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getScenarioTemplate, SCENARIO_TEMPLATES, type ScenarioType } from '@/lib/inet/scenarios'
import { validateScenario, ScenarioValidationError } from '@/lib/inet/validation'

export async function GET() {
  const runs = await db.inetRun.findMany({ orderBy: { createdAt: 'desc' }, take: 30, include: { scenario: { select: { name: true, scenarioType: true } } } })
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
    return NextResponse.json({ runId: run.id, scenarioId: scenario.id, status: run.status }, { status: 201 })
  } catch (e) { if (e instanceof ScenarioValidationError) return NextResponse.json({ error: e.message, issues: e.issues }, { status: 400 }); return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
}
