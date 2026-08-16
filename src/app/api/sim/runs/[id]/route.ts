import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/sim/runs/:id - 单次实验完整详情（含每次运行明细与训练曲线）
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await db.simRun.findUnique({ where: { id } })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(run)
}
