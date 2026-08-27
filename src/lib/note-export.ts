import * as XLSX from 'xlsx'

export interface NoteExportRow {
  author: string
  title: string
  journal: string
  lastRead: string
}

/** 把文献笔记（含结构化 JSON）映射为导出行：作者 / 题目 / 期刊 / 最近读日期 */
export function buildReadingNoteRows(notes: unknown[]): Record<string, string>[] {
  return notes.map((n) => {
    const note = n as Record<string, unknown>
    let s: Record<string, string> = {}
    try {
      s = JSON.parse(String(note.structured || '{}')) as Record<string, string>
    } catch {
      s = {}
    }
    const lastRead = note.lastReadAt
      ? new Date(String(note.lastReadAt)).toISOString().slice(0, 10)
      : ''
    return {
      作者: s.author || '',
      题目: String(note.title || ''),
      期刊: s.journal || '',
      '最近一次读的日期': lastRead,
    }
  })
}

/** 生成 xlsx 工作簿 Buffer（列宽已设置） */
export function generateNotesXlsx(rows: Record<string, string>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ['作者', '题目', '期刊', '最近一次读的日期'],
    skipHeader: false,
  })
  ws['!cols'] = [{ wch: 24 }, { wch: 44 }, { wch: 20 }, { wch: 18 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '文献阅读笔记')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
