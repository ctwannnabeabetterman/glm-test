/**
 * Zotero Web API 客户端 —— 只拉元数据，不自动调 LLM。
 * 文档：https://www.zotero.org/support/dev/web_api/v3/basics
 */

import type { BibliographyRecord } from './bibliography'

export interface ZoteroConfig {
  userId: string
  apiKey: string
  collectionKey?: string
}

export interface ZoteroFetchResult {
  items: BibliographyRecord[]
  fetched: number
  truncated: boolean
}

interface ZoteroCreator {
  creatorType?: string
  firstName?: string
  lastName?: string
  name?: string
}

interface ZoteroItem {
  key?: string
  data?: {
    key?: string
    itemType?: string
    title?: string
    creators?: ZoteroCreator[]
    publicationTitle?: string
    bookTitle?: string
    conferenceName?: string
    proceedingsTitle?: string
    date?: string
    DOI?: string
    extra?: string
    tags?: { tag?: string }[]
    abstractNote?: string
    url?: string
  }
}

function creatorName(c: ZoteroCreator): string {
  if (c.name) return c.name.trim()
  return [c.lastName, c.firstName].filter(Boolean).join(', ').trim()
}

function yearFromDate(date?: string): number {
  const m = (date || '').match(/(19|20)\d{2}/)
  return m ? Number(m[0]) : 0
}

export function mapZoteroItem(item: ZoteroItem): BibliographyRecord | null {
  const d = item.data
  if (!d) return null
  const skip = new Set(['attachment', 'note', 'annotation'])
  if (d.itemType && skip.has(d.itemType)) return null
  const title = (d.title || '').trim()
  if (!title) return null
  const authors = (d.creators || [])
    .filter((c) => !c.creatorType || ['author', 'editor'].includes(c.creatorType))
    .map(creatorName)
    .filter(Boolean)
    .join(', ')
  return {
    title,
    authors,
    venue: d.publicationTitle || d.conferenceName || d.proceedingsTitle || d.bookTitle || '',
    year: yearFromDate(d.date),
    doi: (d.DOI || '').trim(),
    tags: (d.tags || []).map((t) => t.tag || '').filter(Boolean).join(', '),
    notes: d.abstractNote || '',
    url: d.url || '',
    zoteroKey: d.key || item.key || '',
  }
}

export async function fetchZoteroItems(cfg: ZoteroConfig, limit = 100): Promise<ZoteroFetchResult> {
  const userId = cfg.userId.trim()
  const apiKey = cfg.apiKey.trim()
  if (!userId || !apiKey) throw new Error('请先在设置页填写 Zotero User ID 与 API Key')

  const cap = Math.min(200, Math.max(1, limit))
  const items: BibliographyRecord[] = []
  let start = 0
  let truncated = false
  const collection = cfg.collectionKey?.trim()
  const base = collection
    ? `https://api.zotero.org/users/${userId}/collections/${collection}/items`
    : `https://api.zotero.org/users/${userId}/items`

  while (items.length < cap) {
    const pageSize = Math.min(100, cap - items.length)
    const url = `${base}?format=json&itemType=-attachment&sort=dateModified&direction=desc&limit=${pageSize}&start=${start}`
    const res = await fetch(url, {
      headers: {
        'Zotero-API-Version': '3',
        Authorization: `Bearer ${apiKey}`,
      },
    })
    if (res.status === 403 || res.status === 401) {
      throw new Error('Zotero 鉴权失败：请检查 User ID / API Key 是否匹配，并确认 Key 有 library 读取权限')
    }
    if (!res.ok) throw new Error(`Zotero API 返回 ${res.status}`)
    const page = (await res.json()) as ZoteroItem[]
    if (!Array.isArray(page) || page.length === 0) break
    for (const it of page) {
      const rec = mapZoteroItem(it)
      if (rec) items.push(rec)
    }
    start += page.length
    if (page.length < pageSize) break
    if (start >= 500) {
      truncated = true
      break
    }
  }

  return { items, fetched: items.length, truncated }
}
