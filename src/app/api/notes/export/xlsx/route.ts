import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildReadingNoteRows, generateNotesXlsx } from '@/lib/note-export'

// GET /api/notes/export/xlsx —— 一键导出文献阅读笔记为 Excel
// 列：作者 / 题目 / 期刊 / 最近一次读的日期（每行一篇文献阅读笔记）
export async function GET(request: NextRequest) {
  try {
    const filter = request.nextUrl.searchParams.get('category')
    const notes = await db.note.findMany({
      where: filter ? { category: filter } : { category: 'literature' },
      orderBy: [{ lastReadAt: 'desc' }],
    })

    const rows = buildReadingNoteRows(notes)
    const buf = generateNotesXlsx(rows)
    const filename = `文献阅读笔记-${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (e) {
    console.error('export notes xlsx error', e)
    return NextResponse.json({ error: '导出失败: ' + (e as Error).message }, { status: 500 })
  }
}
