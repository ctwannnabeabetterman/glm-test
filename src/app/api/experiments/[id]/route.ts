import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'

const statuses = new Set(['planned', 'running', 'completed', 'failed'])
const jsonFields = ['config', 'metrics', 'baselines', 'ablations'] as const

type JsonField = (typeof jsonFields)[number]

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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid experiment payload' }, { status: 400 })
    }
    const input = body as Record<string, unknown>
    const data: Record<string, string | number> = {}
    for (const field of ['name', 'topic', 'status', 'notes'] as const) {
      if (input[field] === undefined) continue
      if (typeof input[field] !== 'string' || (field === 'name' && !(input[field] as string).trim()) ||
          (field === 'status' && !statuses.has(input[field] as string))) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 })
      }
      data[field] = field === 'name' ? (input[field] as string).trim() : input[field] as string
    }
    if (input.seed !== undefined) {
      const seed = seedValue(input.seed)
      if (seed === null) return NextResponse.json({ error: 'Invalid seed' }, { status: 400 })
      data.seed = seed
    }
    for (const field of jsonFields) {
      if (input[field] === undefined) continue
      if (!jsonField(input[field], field)) {
        return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 })
      }
      data[field] = input[field]
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }
    const experiment = await db.experiment.update({ where: { id }, data })
    void recordActivity({ module: 'experiment', action: 'update', title: `更新了实验记录「${experiment.name}」`, refId: experiment.id })
    return NextResponse.json(experiment)
  } catch (e) {
    console.error('PUT experiment error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const removedExperiment = await db.experiment.findUnique({ where: { id }, select: { name: true } })
    await db.experiment.delete({ where: { id } })
    void recordActivity({ module: 'experiment', action: 'delete', title: `删除了实验记录「${removedExperiment?.name ?? id}」`, refId: id })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE experiment error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
