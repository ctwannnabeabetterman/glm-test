import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { markdownToPlainText, renderManuscriptMarkdown, safeFileName } from '@/lib/writing/draft'
import { resolveManuscriptReferences } from '@/lib/writing/resolve'

const SUPPORTED = ['md', 'txt'] as const
type Format = (typeof SUPPORTED)[number]

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const format = (request.nextUrl.searchParams.get('format') || 'md').toLowerCase()
    // 与 /api/notes/export 保持一致：不支持的格式显式 400，绝不静默回退成别的格式
    // （静默回退会让用户以为拿到了想要的格式，实际是另一种，比报错更难发现）
    if (!SUPPORTED.includes(format as Format)) {
      return NextResponse.json(
        { error: `Unsupported format: ${format}`, supported: SUPPORTED },
        { status: 400 },
      )
    }

    const row = await db.manuscript.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const resolved = await resolveManuscriptReferences(id)
    if (!resolved) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const markdown = renderManuscriptMarkdown({
      title: row.title,
      venue: row.venue,
      sections: resolved.sections,
      references: resolved.references,
    })

    const isTxt = format === 'txt'
    const filename = `${safeFileName(row.title)}.${format}`

    return new NextResponse(isTxt ? markdownToPlainText(markdown) : markdown, {
      headers: {
        'Content-Type': isTxt ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8',
        // RFC 5987：中文标题走 filename*，避免下载出乱码文件名
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (e) {
    console.error('GET manuscript export error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
