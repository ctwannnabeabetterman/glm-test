import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { defaultOutline, normalizeSections } from '@/lib/writing/draft'
import { toManuscriptDto } from '@/lib/writing/dto'

export async function GET() {
  try {
    const rows = await db.manuscript.findMany({ orderBy: [{ updatedAt: 'desc' }] })
    return NextResponse.json(rows.map(toManuscriptDto))
  } catch (e) {
    console.error('GET manuscripts error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const hasSections = Array.isArray(body?.sections) && body.sections.length > 0
    const targetWords = Number(body?.targetWords)
    const created = await db.manuscript.create({
      data: {
        title: (typeof body?.title === 'string' && body.title.trim()) || '未命名稿件',
        venue: typeof body?.venue === 'string' ? body.venue : '',
        targetWords: Number.isFinite(targetWords) ? Math.max(0, Math.floor(targetWords)) : 0,
        // 不传章节就给一套默认骨架，避免用户新建后面对空白页面
        sections: JSON.stringify(hasSections ? normalizeSections(body.sections) : defaultOutline()),
      },
    })
    return NextResponse.json(toManuscriptDto(created), { status: 201 })
  } catch (e) {
    console.error('POST manuscripts error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
