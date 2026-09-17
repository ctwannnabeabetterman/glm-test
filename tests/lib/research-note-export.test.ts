import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildResearchNoteMarkdown } from '../../src/lib/library/research-note'
import { buildSimplePdf } from '../../src/lib/library/pdf'
import { downloadBlob } from '../../src/lib/download'
import { existsSync, writeFileSync } from 'node:fs'

afterEach(() => vi.unstubAllGlobals())

/**
 * 「真的内嵌了 CJK 字体」这个不变量，必须与字体的**轮廓风味**无关。
 *
 * 历史：这里曾经写死 `/FontFile2`，它只是 **TrueType** 的内嵌写法；CFF/OpenType 按 PDF
 * 规范编成 `/FontFile3`。2026-09-17 CI 上 runner 镜像把 fonts-noto-cjk 换成 CFF 风味后，
 * 同一份代码从绿变红 —— 被拦下的其实是「换了个字体文件格式」，不是真问题。
 *
 * 实测（.recon/pdf-font-flavor.mjs）：
 *   · msyh.ttf / msyh.ttc           → /FontFile2 + /CIDFontType2   （TrueType）
 *   · ROGFonts-Regular.otf 等 OpenType → /FontFile3 + /CIDFontType0 （CFF）
 *   · 两者一律 Type0 + Identity-H（CJK 必然走 16 位字形编码，与风味无关）
 */
function expectEmbeddedCjkFont(pdf: Buffer, raw: string) {
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(raw).toContain('/Subtype /Type0')
  expect(raw).toContain('/Encoding /Identity-H')
  expect(raw).toMatch(/\/FontFile[0-9]?/)
  // 反向守卫：绝不能退化成只发一份拉丁 base-14 字体的「假中文 PDF」
  expect(raw).not.toContain('/BaseFont /Helvetica')
}

/** 本机上可用的 CFF/OpenType 风味 CJK 字体（用于跨风味回归）。优先真正的 CJK 字体。 */
const CFF_FONT_CANDIDATES = [
  'C:/Windows/Fonts/Noto Sans SC (TrueType).otf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  'C:/Windows/Fonts/ROGFonts-Regular.otf',
]
const availableCffFont = CFF_FONT_CANDIDATES.find((p) => existsSync(p))

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
    const raw = pdf.toString('latin1')
    expectEmbeddedCjkFont(pdf, raw)
    expect((raw.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(2)
    if (process.env.EXPORT_TEST_PDF) writeFileSync(process.env.EXPORT_TEST_PDF, pdf)
  })
  // 这条用例专门把导出路径**强行切到 CFF 风味字体**，把「断言绑死 TrueType」这个 bug
  // 在开发机（Windows 默认字体是 TrueType 的 msyh）上也能复现出来。
  // Linux CI 上 NOTE_PDF_FONT 指向的 Noto 本身就是 CFF，因此两边都覆盖到。
  it.skipIf(!availableCffFont)(
    'keeps the same embedded-font invariant on CFF/OpenType flavored fonts',
    async () => {
      const previous = process.env.NOTE_PDF_FONT
      process.env.NOTE_PDF_FONT = availableCffFont
      try {
        const pdf = Buffer.from(await buildSimplePdf('中文 CFF 风味导出验证', '第1行：CFF 字体内嵌验证，网络仿真与研究方法。\n末尾完整性标记'))
        const raw = pdf.toString('latin1')
        expectEmbeddedCjkFont(pdf, raw)
        // 明确锁定这条用例走的确实是 CFF 分支，否则它会静默退化成和上面一条一样的测试
        expect(raw).toContain('/CIDFontType0')
        expect(raw).toContain('/FontFile3')
      } finally {
        if (previous === undefined) delete process.env.NOTE_PDF_FONT
        else process.env.NOTE_PDF_FONT = previous
      }
    },
  )
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
