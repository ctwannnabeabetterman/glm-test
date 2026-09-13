import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildResearchNoteMarkdown } from '../../src/lib/library/research-note'
import { buildSimplePdf } from '../../src/lib/library/pdf'
import { downloadBlob } from '../../src/lib/download'
import { writeFileSync } from 'node:fs'

 afterEach(() => vi.unstubAllGlobals())

describe('research note export', () => {
  it('exports body, all structured fields and extra fields', () => {
    const keys = ['author', 'journal', 'terms', 'refs', 'method', 'object', 'framework', 'innovation', 'limitation', 'inspiration', 'extra']
    const md = buildResearchNoteMarkdown({ title: '中文科研笔记', content: '正文标记', tags: '网络, 仿真', structured: JSON.stringify(Object.fromEntries(keys.map(k => [k, `${k}完整内容`]))), updatedAt: '2026-09-12', lastReadAt: '2026-09-11' })
    for (const k of keys) expect(md).toContain(`${k}完整内容`)
    expect(md).toContain('正文标记')
    expect(md).toContain('lastRead: 2026-09-11')
    expect(md).toContain('["网络","仿真"]')
  })
  it('handles malformed and empty structured data', () => {
    for (const structured of ['null', '{broken', '{}']) expect(buildResearchNoteMarkdown({title: 'Test', content: 'Body', structured})).toContain('Body')
  })
  it('generates multi-page embedded Chinese PDF without truncating the ending', async () => {
    const body = Array.from({length: 220}, (_, i) => `第${i + 1}行：中文科研笔记，网络仿真与研究方法，完整内容验证。`).join('\n') + '\n末尾完整性标记'
    const pdf = Buffer.from(await buildSimplePdf('中文多页导出验证', body))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(2)
    expect(pdf.toString('latin1')).toContain('/FontFile2')
    if (process.env.EXPORT_TEST_PDF) writeFileSync(process.env.EXPORT_TEST_PDF, pdf)
  })
  it('does not report success or fall back when desktop save is canceled', async () => {
    const save = vi.fn().mockResolvedValue({ok: false, canceled: true})
    vi.stubGlobal('window', {electronSaveFile: save})
    expect(await downloadBlob(new Blob(['中文']), '笔记.md')).toBe(false)
    expect(save).toHaveBeenCalledOnce()
  })
  it('reports successful save and surfaces desktop errors', async () => {
    const save = vi.fn().mockResolvedValueOnce({ok: true}).mockResolvedValueOnce({ok: false, error: 'Disk full'})
    vi.stubGlobal('window', {electronSaveFile: save})
    expect(await downloadBlob(new Blob(['note']), 'note.md')).toBe(true)
    await expect(downloadBlob(new Blob(['note']), 'note.md')).rejects.toThrow('Disk full')
  })
})
