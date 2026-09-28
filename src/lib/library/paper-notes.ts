/**
 * 论文阅读笔记导出 —— Markdown / 纯文本 / 简易 PDF。
 * 导出对象是「这一篇论文的阅读笔记」，不是论文列表。
 */

import { hasPassContent, parseReadingProgress, passNotes } from './reading-progress'

export interface PaperNoteSource {
  title: string
  authors?: string
  venue?: string
  year?: number
  tags?: string
  notes?: string
  readingProgress?: string
}

export function sanitizeFilename(name: string): string {
  const s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()
  return (s || 'untitled').slice(0, 80)
}

export function buildPaperMarkdown(paper: PaperNoteSource): string {
  // 解析收敛到 `./reading-progress`（三遍进度的唯一定义处）：
  // 这里以前有一份与组件逐字重复的 `parseProgress`，改一处忘一处就会出现
  // 「界面显示三遍读完、导出的 Markdown 少一段」。2026-09-28 合并。
  const progress = parseReadingProgress(paper.readingProgress)
  const tags = (paper.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const yamlTags = tags.length ? `[${tags.join(', ')}]` : '[]'
  const passBlock = [
    hasPassContent(progress, 'pass1') ? `## 第一遍 · 快速筛选\n\n${passNotes(progress, 'pass1') || '（已完成，无文字）'}` : '',
    hasPassContent(progress, 'pass2') ? `## 第二遍 · 把握结构\n\n${passNotes(progress, 'pass2') || '（已完成，无文字）'}` : '',
    hasPassContent(progress, 'pass3') ? `## 第三遍 · 精读\n\n${passNotes(progress, 'pass3') || '（已完成，无文字）'}` : '',
  ].filter(Boolean).join('\n\n')

  return `---
title: ${JSON.stringify(paper.title || '')}
authors: ${JSON.stringify(paper.authors || '')}
venue: ${JSON.stringify(paper.venue || '')}
year: ${paper.year || ''}
tags: ${yamlTags}
exportedAt: ${new Date().toISOString()}
---

# ${paper.title || '未命名论文'}

- 作者：${paper.authors || '—'}
- 期刊/会议：${paper.venue || '—'}
- 年份：${paper.year || '—'}
${tags.length ? `- 标签：${tags.map((t) => '#' + t).join(' ')}` : ''}

## 阅读笔记

${paper.notes?.trim() || '（暂无笔记）'}
${passBlock ? `\n${passBlock}\n` : ''}
`
}

export function buildPaperPlainText(paper: PaperNoteSource): string {
  return `${paper.title || '未命名论文'}
${'='.repeat(Math.min(60, (paper.title || '').length || 8))}

作者：${paper.authors || '—'}
期刊/会议：${paper.venue || '—'}
年份：${paper.year || '—'}

阅读笔记
--------
${paper.notes?.trim() || '（暂无笔记）'}
`
}

/** 极简 PDF（Helvetica + WinAnsi，中文会以十六进制字节保留，Obsidian/阅读器可复制原文） */
function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function buildSimplePdf(title: string, body: string): Uint8Array {
  const lines = [`${title}`, '', ...body.replace(/\r\n/g, '\n').split('\n')]
  const wrapped: string[] = []
  for (const line of lines) {
    if (line.length <= 90) wrapped.push(line)
    else {
      for (let i = 0; i < line.length; i += 90) wrapped.push(line.slice(i, i + 90))
    }
  }
  const pageLines = wrapped.slice(0, 60)
  const content = pageLines
    .map((line, i) => `BT /F1 11 Tf 48 ${780 - i * 12} Td (${pdfEscape(line)}) Tj ET`)
    .join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let offset = '%PDF-1.4\n'.length
  const offsets = [0]
  let bodyOut = '%PDF-1.4\n'
  objects.forEach((obj, i) => {
    offsets.push(offset)
    const chunk = `${i + 1} 0 obj\n${obj}\nendobj\n`
    bodyOut += chunk
    offset += Buffer.byteLength(chunk, 'utf8')
  })
  const xrefStart = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return new Uint8Array(Buffer.from(bodyOut + xref + trailer, 'utf8'))
}

/**
 * CSV 单元格转义。
 *
 * 做两件事，缺一件都不够：
 *  1. 常规转义（含 `,` `"` 换行的单元格加引号、引号翻倍）；
 *  2. **中和公式前缀** —— 以 `=` `+` `-` `@` 或制表/回车开头的单元格会被
 *     Excel / WPS 当**公式**执行（DDE、HYPERLINK 之类）。
 *
 * 为什么第 2 件在这里特别要紧：论文标题与作者来自 Crossref / Zotero / BibTeX
 * ——**都是外部输入**，用户只是「导入一篇文献」，不该在打开导出表格时执行别人写的东西。
 * 这是我们这个应用唯一真正存在的注入面（SQL 侧全走 Prisma 参数化、无裸 SQL）。
 *
 * ⚠️ 但**纯数字不要加前缀**：`-5` / `-3.5e2` 是合法的负数（扫参导出里就有），
 * 加个 `'` 会把它变成文本、破坏后续计算。所以只对「以符号开头**且整体不是数字**」的
 * 值做中和。
 */
const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/
const FORMULA_PREFIX = /^[=+\-@\t\r]/

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  // Excel/WPS 把前置单引号视为「强制文本」，且不显示这个引号
  const safe = FORMULA_PREFIX.test(s) && !NUMERIC.test(s) ? `'${s}` : s
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}

/** Excel 可直接打开的论文列表 CSV（带 UTF-8 BOM） */
export function buildPapersCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}
