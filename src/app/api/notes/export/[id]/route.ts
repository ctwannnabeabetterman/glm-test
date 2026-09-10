import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildPaperMarkdown, buildSimplePdf, sanitizeFilename } from '@/lib/library/paper-notes'

function noteToMarkdown(note: { title: string; content: string; tags: string; category: string; updatedAt: Date }): string {
  return `---
title: ${JSON.stringify(note.title)}
category: ${note.category}
tags: [${note.tags}]
updatedAt: ${note.updatedAt.toISOString()}
---

# ${note.title}

${note.content || ''}
`
}

// GET /api/notes/export/:id?format=md|pdf —— 单篇科研笔记真正落盘
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const format = request.nextUrl.searchParams.get('format') || 'md'
    const note = await db.note.findUnique({ where: { id } })
    if (!note) return NextResponse.json({ error: '笔记不存在' }, { status: 404 })
    const name = sanitizeFilename(note.title)
    const md = noteToMarkdown(note)
    if (format === 'pdf') {
      const pdf = buildSimplePdf(note.title, `${note.title}\n\n${note.content || ''}`)
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.pdf')}`,
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
