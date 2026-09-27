import { db } from '@/lib/db'
import { normalizeTitle, type BibliographyRecord } from './bibliography'
import type { MergeConflict } from './merge-conflicts'

// 冲突描述与类型定义在 `merge-conflicts.ts`（客户端安全）—— 本文件依赖 Prisma，
// UI 不能直接引它，否则会把 Prisma 拉进浏览器包。这里只做类型的再导出，方便服务端使用。
export type { MergeConflict }
export { describeConflicts } from './merge-conflicts'

export interface MergeStats {
  created: number
  updated: number
  skipped: number
  /** 本次写入/刷新了摘要的条数（让用户知道 AI 摘要的原料是否到手） */
  abstracts: number
  /**
   * 因**身份冲突**而未写入的条目。
   *
   * 为什么必须单独返回：这类条目是「库里已有一条同名、但 DOI/Zotero 标识不同」，
   * 既不能合并（会覆盖别人的科研记录）也不能新建（会造同名副本），于是**不写入**。
   * 但「不写入」如果只是悄悄 `skipped++`，用户看到的是「我导入了它却没出现」，
   * 而且没有任何线索 —— 等于把冲突藏起来。这里把冲突连同原因一并交回调用方呈现。
   */
  conflicts: MergeConflict[]
}

function yearOf(n: number): number | undefined {
  return n && n > 1800 && n < 2100 ? n : undefined
}

type IndexedPaper = {
  id: string
  title: string
  doi: string
  zoteroKey: string
  tags: string
  notes: string
  abstract: string
  pdfUrl: string
}

const doiKey = (s: string) => s.trim().toLowerCase()
const zoteroKey = (s: string) => s.trim()

/** 按强身份优先、精确归一标题兜底合并；歧义或强身份冲突一律跳过。不调用 LLM。 */
export async function mergeBibliography(records: BibliographyRecord[]): Promise<MergeStats> {
  const existing = await db.paper.findMany({
    select: {
      id: true, title: true, doi: true, zoteroKey: true, tags: true,
      notes: true, abstract: true, pdfUrl: true,
    },
  })
  const papers = new Map<string, IndexedPaper>(existing.map((p) => [p.id, p]))

  let created = 0
  let updated = 0
  let skipped = 0
  let abstracts = 0
  const conflicts: MergeConflict[] = []

  for (const rec of records) {
    const title = normalizeTitle(rec.title)
    if (!title) {
      skipped++
      continue
    }
    const doi = doiKey(rec.doi)
    const zotero = zoteroKey(rec.zoteroKey)
    const all = [...papers.values()]
    const strong = all.filter((p) =>
      (doi && doiKey(p.doi) === doi) || (zotero && zoteroKey(p.zoteroKey) === zotero),
    )
    const titleMatches = all.filter((p) => normalizeTitle(p.title) === title)
    // 标题仅在候选唯一且没有不同的强身份时用于补全旧的手工记录。
    // 同名但不同 DOI / Zotero key 不可自动改写；也不让新身份抢占别的记录的 key。
    const hit = strong.length === 1 ? strong[0] : strong.length === 0 && titleMatches.length === 1 ? titleMatches[0] : undefined
    const conflicting = (p: IndexedPaper) =>
      Boolean((doi && p.doi && doiKey(p.doi) !== doi) ||
        (zotero && p.zoteroKey && zoteroKey(p.zoteroKey) !== zotero))
    // 老版本曾将 BibTeX citation key 存为 Zotero key；只凭 Zotero key 而标题
    // 不同时不能安全判定是同一文献（真实 DOI 相同则仍允许标题变化）。
    const doiMatched = Boolean(hit && doi && doiKey(hit.doi) === doi)
    if (strong.length > 1) {
      conflicts.push({
        title: rec.title,
        reason: `库里有 ${strong.length} 条记录匹配同一 DOI / Zotero 标识，无法确定合并到哪一条`,
      })
      skipped++
      continue
    }
    if (hit && conflicting(hit)) {
      conflicts.push({ title: rec.title, reason: '库里的同标识条目带有不同的 DOI / Zotero 标识' })
      skipped++
      continue
    }
    if (hit && strong.length === 1 && !doiMatched && normalizeTitle(hit.title) !== title) {
      conflicts.push({
        title: rec.title,
        reason: 'Zotero 标识相同但标题不同（老版本可能把 BibTeX 引用键存成了 Zotero 标识）',
      })
      skipped++
      continue
    }
    if (hit && titleMatches.some((p) => p.id !== hit.id)) {
      conflicts.push({ title: rec.title, reason: `库里有 ${titleMatches.length} 条同名记录，无法确定合并到哪一条` })
      skipped++
      continue
    }
    // 已有同名、但身份相斥或候选不唯一：不创建同名副本，也不挑一个覆盖。
    if (!hit && titleMatches.length) {
      conflicts.push({
        title: rec.title,
        reason: '库中已存在同名文献，但 DOI / Zotero 标识不同 —— 未自动合并，请人工确认是否同一篇',
      })
      skipped++
      continue
    }

    if (hit) {
      const nextTags = Array.from(
        new Set([...(hit.tags || '').split(','), ...(rec.tags || '').split(',')].map((t) => t.trim()).filter(Boolean))
      ).join(', ')
      // 摘要策略：**已有内容优先保留**（可能是用户手改过或从 PDF 抽的，比源元数据更准），
      // 只有原本为空时才用导入的值补上。与 notes 的处理保持一致。
      const keepAbstract = (hit.abstract || '').trim() ? hit.abstract : rec.abstract || ''
      const filledAbstract = !(hit.abstract || '').trim() && Boolean((rec.abstract || '').trim())
      const next = {
        authors: rec.authors || undefined,
        venue: rec.venue || undefined,
        year: yearOf(rec.year),
        doi: rec.doi || undefined,
        zoteroKey: rec.zoteroKey || undefined,
        tags: nextTags || undefined,
        pdfUrl: rec.url || undefined,
        abstract: keepAbstract || undefined,
        notes: hit.notes?.trim() ? hit.notes : rec.notes || undefined,
      }
      await db.paper.update({ where: { id: hit.id }, data: next })
      // 刷新批内的标签/摘要/身份：后续条目必须看见这次写入，而不是初始快照。
      papers.set(hit.id, {
        ...hit,
        doi: next.doi ?? hit.doi,
        zoteroKey: next.zoteroKey ?? hit.zoteroKey,
        tags: next.tags ?? hit.tags,
        pdfUrl: next.pdfUrl ?? hit.pdfUrl,
        abstract: next.abstract ?? hit.abstract,
        notes: next.notes ?? hit.notes,
      })
      if (filledAbstract) abstracts++
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
          abstract: rec.abstract || '',
          notes: rec.notes,
          pdfUrl: rec.url,
          status: 'unread',
          priority: 'medium',
          category: 'method',
        },
      })
      if ((rec.abstract || '').trim()) abstracts++
      papers.set(createdPaper.id, createdPaper)
      created++
    }
  }

  return { created, updated, skipped, abstracts, conflicts }
}
