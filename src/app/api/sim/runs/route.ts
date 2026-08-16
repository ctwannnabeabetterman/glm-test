import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/sim/runs - 仿真实验历史（可选 ?topology=&algorithm= 过滤）
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const where: { topology?: string; algorithm?: string } = {}
  const topology = sp.get('topology')
  const algorithm = sp.get('algorithm')
  if (topology) where.topology = topology
  if (algorithm) where.algorithm = algorithm
  const runs = await db.simRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Number(sp.get('limit')) || 30),
    select: {
      id: true,
      label: true,
      topology: true,
      algorithm: true,
      seed: true,
      params: true,
      metrics: true,
      status: true,
      error: true,
      createdAt: true,
    },
  })
  return NextResponse.json(runs)
}

// DELETE /api/sim/runs?id=xxx - 删除一条实验记录
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  await db.simRun.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
