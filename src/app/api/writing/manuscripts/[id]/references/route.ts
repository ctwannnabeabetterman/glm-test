import { NextRequest, NextResponse } from 'next/server'
import { resolveManuscriptReferences } from '@/lib/writing/resolve'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const resolved = await resolveManuscriptReferences(id)
    if (!resolved) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      references: resolved.references,
      total: resolved.references.length,
      // 前端据此提示"有 N 条引用不在文献库里"，而不是静默少条
      missing: resolved.missing,
    })
  } catch (e) {
    console.error('GET manuscript references error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
