import { describe, it, expect } from 'vitest'
import { buildReadingNoteRows, generateNotesXlsx } from '@/lib/note-export'
import * as XLSX from 'xlsx'

describe('buildReadingNoteRows', () => {
  it('maps structured author/journal + note title + lastReadAt to export columns', () => {
    const notes = [
      {
        title: 'Deep Reinforcement Learning for Wireless Networks',
        category: 'literature',
        structured: JSON.stringify({ author: 'Zhang et al.', journal: 'IEEE TCOM' }),
        lastReadAt: new Date('2026-08-01T10:00:00Z'),
      },
    ]
    const rows = buildReadingNoteRows(notes)
    expect(rows).toEqual([
      {
        作者: 'Zhang et al.',
        题目: 'Deep Reinforcement Learning for Wireless Networks',
        期刊: 'IEEE TCOM',
        '最近一次读的日期': '2026-08-01',
      },
    ])
  })

  it('falls back to empty strings when structured fields are missing', () => {
    const rows = buildReadingNoteRows([{ title: 'A paper', structured: '{}', lastReadAt: null }])
    expect(rows[0]).toEqual({
      作者: '',
      题目: 'A paper',
      期刊: '',
      '最近一次读的日期': '',
    })
  })

  it('tolerates malformed structured JSON', () => {
    const rows = buildReadingNoteRows([{ title: 'Broken', structured: 'not-json{', lastReadAt: null }])
    expect(rows[0].作者).toBe('')
    expect(rows[0].题目).toBe('Broken')
  })

  it('renders lastReadAt date only (no time), using UTC', () => {
    const rows = buildReadingNoteRows([
      { title: 'T', structured: '{}', lastReadAt: new Date('2026-12-31T23:59:59Z') },
    ])
    expect(rows[0]['最近一次读的日期']).toBe('2026-12-31')
  })
})

describe('generateNotesXlsx', () => {
  it('produces a parseable workbook with the expected header and values', () => {
    const rows = buildReadingNoteRows([
      {
        title: 'Paper A',
        structured: JSON.stringify({ author: 'Alice', journal: 'IEEE TWC' }),
        lastReadAt: new Date('2026-08-15T00:00:00Z'),
      },
    ])
    const buf = generateNotesXlsx(rows)
    expect(buf.length).toBeGreaterThan(1000)

    const wb = XLSX.read(buf, { type: 'buffer' })
    const sheet = wb.Sheets['文献阅读笔记']
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][]
    expect(aoa[0]).toEqual(['作者', '题目', '期刊', '最近一次读的日期'])
    expect(aoa[1]).toEqual(['Alice', 'Paper A', 'IEEE TWC', '2026-08-15'])
  })
})
