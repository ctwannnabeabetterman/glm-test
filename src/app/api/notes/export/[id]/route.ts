import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildSimplePdf } from '@/lib/library/pdf'
import { buildResearchNoteMarkdown, buildResearchNotePlainText, sanitizeFilename } from '@/lib/library/research-note'

// GET /api/notes/export/:id?format=md|pdf|txt —— 单篇科研笔记落盘（含阅读思考模板字段）
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const format = request.nextUrl.searchParams.get('format') || 'md'
    const note = await db.note.findUnique({ where: { id } })
    if (!note) return NextResponse.json({ error: '笔记不存在' }, { status: 404 })
    const name = sanitizeFilename(note.title)
    const md = buildResearchNoteMarkdown(note)
    if (format === 'pdf') {
      const pdf = await buildSimplePdf(note.title, buildResearchNotePlainText(note))
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.pdf')}`,
        },
      })
    }
    if (format === 'txt') {
      return new NextResponse(buildResearchNotePlainText(note), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.txt')}`,
        },
      })
    }
    return new NextResponse(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.md')}`,
      },
    })
  } catch (e) {
    console.error('export note error', e)
    return NextResponse.json({ error: '导出失败: ' + (e as Error).message }, { status: 500 })
  }
}
