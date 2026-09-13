import { sanitizeFilename } from './paper-notes'

export interface ResearchNoteSource {
  title: string
  content?: string
  tags?: string
  category?: string
  updatedAt?: Date | string
  lastReadAt?: Date | string | null
  structured?: string | Record<string, unknown>
}

const STRUCT_LABELS: Record<string, string> = {
  author: '作者',
  journal: '期刊 / 会议',
  terms: '术语记录',
  refs: '参考文献导入',
  method: '研究方法',
  object: '研究对象',
  framework: '理论框架',
  innovation: '创新点',
  limitation: '局限性',
  inspiration: '对我的启发',
}

function parseStructured(raw?: string | Record<string, unknown>): Record<string, string> {
  if (!raw) return {}
  if (typeof raw === 'object') {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v == null ? '' : String(v)]))
  }
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v == null ? '' : String(v)]))
  } catch {
    return {}
  }
}

export function buildResearchNoteMarkdown(note: ResearchNoteSource): string {
  const structured = parseStructured(note.structured)
  const tags = (note.tags || '').split(',').map((t) => t.trim()).filter(Boolean)
  const updated = note.updatedAt ? new Date(note.updatedAt).toISOString() : new Date().toISOString()
  const lastRead = note.lastReadAt ? new Date(note.lastReadAt).toISOString().slice(0, 10) : ''
  const labels = { ...STRUCT_LABELS, ...Object.fromEntries(Object.keys(structured).filter((key) => !(key in STRUCT_LABELS)).map((key) => [key, key])) }
  const structBlock = Object.entries(labels)
    .map(([key, label]) => {
      const val = (structured[key] || '').trim()
      return val ? `## ${label}\n\n${val}` : ''
    })
    .filter(Boolean)
    .join('\n\n')

  return `---
title: ${JSON.stringify(note.title || '')}
category: ${note.category || 'literature'}
tags: ${JSON.stringify(tags)}
updatedAt: ${updated}
${lastRead ? `lastRead: ${lastRead}\n` : ''}---

# ${note.title || '未命名笔记'}

${note.content?.trim() ? note.content.trim() + '\n' : ''}${structBlock ? `\n${structBlock}\n` : ''}
`
}

export function buildResearchNotePlainText(note: ResearchNoteSource): string {
  const md = buildResearchNoteMarkdown(note)
  return md.replace(/^---[\s\S]*?---\n+/, '')
}

export { sanitizeFilename }
