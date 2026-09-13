import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildPaperMarkdown, buildPaperPlainText, sanitizeFilename } from '@/lib/library/paper-notes'
import { buildSimplePdf } from '@/lib/library/pdf'

// GET /api/papers/:id/notes?format=md|txt|pdf —— 导出这一篇论文的阅读笔记
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const format = request.nextUrl.searchParams.get('format') || 'md'
    const paper = await db.paper.findUnique({ where: { id } })
    if (!paper) return NextResponse.json({ error: '论文不存在' }, { status: 404 })

    const name = sanitizeFilename(paper.title)
    if (format === 'txt') {
      const text = buildPaperPlainText(paper)
      return new NextResponse(text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.txt')}`,
        },
      })
    }
    if (format === 'pdf') {
      const md = buildPaperPlainText(paper)
      const pdf = await buildSimplePdf(paper.title, md)
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.pdf')}`,
        },
      })
    }
    const md = buildPaperMarkdown(paper)
    return new NextResponse(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.md')}`,
      },
    })
  } catch (e) {
    console.error('export paper notes error', e)
    return NextResponse.json({ error: '导出失败: ' + (e as Error).message }, { status: 500 })
  }
}
