import { db } from '@/lib/db'
import { paperIdentityKey, type BibliographyRecord } from './bibliography'

export interface MergeStats {
  created: number
  updated: number
  skipped: number
}

function yearOf(n: number): number | undefined {
  return n && n > 1800 && n < 2100 ? n : undefined
}

/** 按 DOI / Zotero key / 标题去重合并到论文库。不调用 LLM。 */
export async function mergeBibliography(records: BibliographyRecord[]): Promise<MergeStats> {
  const existing = await db.paper.findMany({
    select: { id: true, title: true, doi: true, zoteroKey: true, tags: true, notes: true, pdfUrl: true },
  })
  const byKey = new Map<string, (typeof existing)[number]>()
  for (const p of existing) {
    byKey.set(paperIdentityKey(p), p)
    if (p.zoteroKey) byKey.set(`zotero:${p.zoteroKey}`, p)
    if (p.doi) byKey.set(`doi:${p.doi.toLowerCase()}`, p)
  }

  let created = 0
  let updated = 0
  let skipped = 0

  for (const rec of records) {
    if (!rec.title.trim()) {
      skipped++
      continue
    }
    const keys = [
      rec.doi ? `doi:${rec.doi.toLowerCase()}` : '',
      rec.zoteroKey ? `zotero:${rec.zoteroKey}` : '',
      paperIdentityKey(rec),
    ].filter(Boolean)
    const hit = keys.map((k) => byKey.get(k)).find(Boolean)

    if (hit) {
      const nextTags = Array.from(
        new Set([...(hit.tags || '').split(','), ...(rec.tags || '').split(',')].map((t) => t.trim()).filter(Boolean))
      ).join(', ')
      await db.paper.update({
        where: { id: hit.id },
        data: {
          authors: rec.authors || undefined,
          venue: rec.venue || undefined,
          year: yearOf(rec.year),
          doi: rec.doi || undefined,
          zoteroKey: rec.zoteroKey || undefined,
          tags: nextTags || undefined,
          pdfUrl: rec.url || undefined,
          notes: hit.notes?.trim() ? hit.notes : rec.notes || undefined,
        },
      })
      updated++
    } else {
      const createdPaper = await db.paper.create({
        data: {
          title: rec.title,
          authors: rec.authors,
          venue: rec.venue,
          year: yearOf(rec.year) ?? 2024,
          doi: rec.doi,
          zoteroKey: rec.zoteroKey,
          tags: rec.tags,
          notes: rec.notes,
          pdfUrl: rec.url,
          status: 'unread',
          priority: 'medium',
          category: 'method',
        },
      })
      byKey.set(paperIdentityKey(createdPaper), createdPaper)
      if (createdPaper.zoteroKey) byKey.set(`zotero:${createdPaper.zoteroKey}`, createdPaper)
      if (createdPaper.doi) byKey.set(`doi:${createdPaper.doi.toLowerCase()}`, createdPaper)
      created++
    }
  }

  return { created, updated, skipped }
}
