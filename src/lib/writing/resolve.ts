import { db } from '@/lib/db'
import {
  buildReferences,
  collectCitationIds,
  normalizeSections,
  type DraftSection,
  type ResolvedReference,
} from './draft'

export interface ResolvedManuscript {
  sections: DraftSection[]
  references: ResolvedReference[]
  /** 正文引用了、但文献库里查不到的 paperId */
  missing: string[]
}

/**
 * 取稿件并按正文顺序解析出编号参考文献表。
 *
 * 放在服务端而不是前端，是为了让「引用编号」只有一个权威来源：
 * 界面预览与导出的 md/txt 必须完全一致，否则用户会看到"预览 3 条、导出 4 条"。
 */
export async function resolveManuscriptReferences(
  manuscriptId: string,
): Promise<ResolvedManuscript | null> {
  const row = await db.manuscript.findUnique({ where: { id: manuscriptId } })
  if (!row) return null

  const sections = normalizeSections(row.sections)
  const ids = collectCitationIds(sections)

  const papers = ids.length
    ? await db.paper.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, authors: true, venue: true, year: true, doi: true },
      })
    : []

  const references = buildReferences(ids, papers)
  return { sections, references, missing: references.filter((r) => !r.found).map((r) => r.paperId) }
}
