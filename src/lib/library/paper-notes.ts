/**
 * 论文阅读笔记导出 —— Markdown / 纯文本 / 简易 PDF。
 * 导出对象是「这一篇论文的阅读笔记」，不是论文列表。
 */

export interface PaperNoteSource {
  title: string
  authors?: string
  venue?: string
  year?: number
  tags?: string
  notes?: string
  readingProgress?: string
}

interface PassNotes {
  pass1?: boolean
  pass2?: boolean
  pass3?: boolean
  pass1Notes?: string
  pass2Notes?: string
  pass3Notes?: string
}

function parseProgress(raw?: string): PassNotes {
  try {
    return JSON.parse(raw || '{}') as PassNotes
  } catch {
    return {}
  }
}

export function sanitizeFilename(name: string): string {
  const s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()
  return (s || 'untitled').slice(0, 80)
}

export function buildPaperMarkdown(paper: PaperNoteSource): string {
  const progress = parseProgress(paper.readingProgress)
  const tags = (paper.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const yamlTags = tags.length ? `[${tags.join(', ')}]` : '[]'
  const passBlock = [
    progress.pass1 || progress.pass1Notes ? `## 第一遍 · 快速筛选\n\n${progress.pass1Notes || '（已完成，无文字）'}` : '',
    progress.pass2 || progress.pass2Notes ? `## 第二遍 · 把握结构\n\n${progress.pass2Notes || '（已完成，无文字）'}` : '',
    progress.pass3 || progress.pass3Notes ? `## 第三遍 · 精读\n\n${progress.pass3Notes || '（已完成，无文字）'}` : '',
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

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Excel 可直接打开的论文列表 CSV（带 UTF-8 BOM） */
export function buildPapersCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}
