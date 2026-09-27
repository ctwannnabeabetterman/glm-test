import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'

const statuses = new Set(['planned', 'running', 'completed', 'failed'])
const jsonDefaults = { config: '{}', metrics: '{}', baselines: '[]', ablations: '[]' } as const

type JsonField = keyof typeof jsonDefaults

function jsonField(value: unknown, field: JsonField): value is string {
  if (typeof value !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(value)
    if (field === 'config' || field === 'metrics') {
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
        Object.values(parsed).every((v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))
    }
    return Array.isArray(parsed) && parsed.every((v) =>
      typeof v === 'string' || (v !== null && typeof v === 'object' && !Array.isArray(v) &&
        typeof v.name === 'string' &&
        (field === 'ablations' || typeof v.level === 'string') &&
        (v.status === undefined || typeof v.status === 'string') &&
        (v.impact === undefined || (typeof v.impact === 'number' && Number.isFinite(v.impact))))
    )
  } catch { return false }
}

function seedValue(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= -2147483648 && n <= 2147483647 ? n : null
}

export async function GET() {
  try {
    const experiments = await db.experiment.findMany({ orderBy: [{ createdAt: 'desc' }] })
    return NextResponse.json(experiments)
  } catch (e) {
    console.error('GET experiments error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid experiment payload' }, { status: 400 })
    }
    const input = body as Record<string, unknown>
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const status = input.status === undefined ? 'planned' : input.status
    const seed = input.seed === undefined ? 42 : seedValue(input.seed)
    if (!name || typeof status !== 'string' || !statuses.has(status) || seed === null ||
        (input.topic !== undefined && typeof input.topic !== 'string') ||
        (input.notes !== undefined && typeof input.notes !== 'string') ||
        (Object.keys(jsonDefaults) as JsonField[]).some((field) =>
          input[field] !== undefined && !jsonField(input[field], field))) {
      return NextResponse.json({ error: 'Invalid experiment fields' }, { status: 400 })
    }
    const experiment = await db.experiment.create({
      data: {
        name,
        topic: (input.topic as string | undefined) ?? '',
        status,
        config: (input.config as string | undefined) ?? jsonDefaults.config,
        metrics: (input.metrics as string | undefined) ?? jsonDefaults.metrics,
        baselines: (input.baselines as string | undefined) ?? jsonDefaults.baselines,
        ablations: (input.ablations as string | undefined) ?? jsonDefaults.ablations,
        notes: (input.notes as string | undefined) ?? '',
        seed,
      },
    })
    void recordActivity({ module: 'experiment', action: 'create', title: `新建了实验记录「${experiment.name}」`, refId: experiment.id })
    return NextResponse.json(experiment, { status: 201 })
  } catch (e) {
    console.error('POST experiments error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
