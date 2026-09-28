import { db } from '@/lib/db'
import { parseStringArray } from '@/lib/utils'
import {
  buildReferences,
  collectCitationIds,
  normalizeSections,
  type DraftSection,
  type ResolvedReference,
} from './draft'

/**
 * 一条引文背后的「证据」—— 这篇文献你到底读没读、留没留下痕迹。
 *
 * 为什么要单独一层（方向 A：可追溯的科研证据链，2026-09-28）：
 * 稿件里的 `[@paperId]` 过去只能证明「库里存在这一条题录」，
 * 证明不了「你读过它」。而「引用了一篇自己没读过的文献」恰恰是投稿时最该被拦下的事。
 * 有这层数据，写作页才能当场提醒，而不是等审稿人来问。
 */
export interface ManuscriptEvidence {
  paperId: string
  /** 文献库里的阅读状态：unread / reading / read */
  status: string
  /** 累计阅读时长（**分钟**，与 `/api/research-stats` 同一口径，避免两处换算不一致） */
  readingMinutes: number
  /** 挂到这篇论文上的笔记条数（读过并留下想法，比「已读」标记更强的证据） */
  linkedNotes: number
  /** 库内的引用关系条数（这篇引用别人 + 别人引用这篇） */
  citations: number
}

export interface ResolvedManuscript {
  sections: DraftSection[]
  references: ResolvedReference[]
  /** 正文引用了、但文献库里查不到的 paperId */
  missing: string[]
  /** 与 `references` 同序的证据；查不到的引文不会有证据项 */
  evidence: ManuscriptEvidence[]
}

/**
 * 组装引文证据。
 *
 * 刻意做成**纯函数**：不碰 IO，于是「未读的引文必须被数出来」这类判据
 * 能在单测里钉住，不必起数据库。
 *
 * ⚠️ 引用关系数刻意**不取** `Paper.citations` —— 那是「这篇被学术界引了多少次」
 * 的学术指标，与「本库里建立了多少条引用关系」不是一回事，混用会让证据链说谎。
 * 笔记数从 `Note.paperIds` 反查（笔记侧才是读过并留下想法的痕迹）。
 */
export function buildManuscriptEvidence(
  paperIds: readonly string[],
  papers: ReadonlyArray<{ id: string; status?: string | null; readingTime?: number | null }>,
  noteRows: ReadonlyArray<{ paperIds?: string | null }>,
  citationRows: ReadonlyArray<{ citingPaperId: string; citedPaperId: string }>,
): ManuscriptEvidence[] {
  const wanted = new Set(paperIds)

  const noteCounts = new Map<string, number>()
  for (const note of noteRows) {
    for (const id of parseStringArray(note.paperIds)) {
      if (wanted.has(id)) noteCounts.set(id, (noteCounts.get(id) ?? 0) + 1)
    }
  }

  const citationCounts = new Map<string, number>()
  for (const row of citationRows) {
    // 两端都算：这篇引别人、被别人引，都是「库内已建立的引用关系」
    for (const id of [row.citingPaperId, row.citedPaperId]) {
      if (wanted.has(id)) citationCounts.set(id, (citationCounts.get(id) ?? 0) + 1)
    }
  }

  return papers.map((paper) => ({
    paperId: paper.id,
    // 脏数据（null/空串）一律当未读：证据只会因此更保守，不会把没读的说成读过
    status: paper.status || 'unread',
    readingMinutes: Math.max(0, Math.round((paper.readingTime ?? 0) / 60)),
    linkedNotes: noteCounts.get(paper.id) ?? 0,
    citations: citationCounts.get(paper.id) ?? 0,
  }))
}

/**
 * 取稿件并按正文顺序解析出编号参考文献表，附带每条引文的阅读证据。
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
        // status / readingTime 供证据层用；著录本身只吃上面那几个字段
        select: {
          id: true, title: true, authors: true, venue: true, year: true, doi: true,
          status: true, readingTime: true,
        },
      })
    : []

  const references = buildReferences(ids, papers)

  // 证据数据：笔记按 `paperIds` 反查（SQLite 里没有 JSON 数组包含查询，与论文详情同一做法），
  // 引用关系直接按两端 where 查。单机小库，一次取回即可。
  let noteRows: Array<{ paperIds: string | null }> = []
  let citationRows: Array<{ citingPaperId: string; citedPaperId: string }> = []
  if (ids.length) {
    ;[noteRows, citationRows] = await Promise.all([
      db.note.findMany({ select: { paperIds: true } }),
      db.citation.findMany({
        where: { OR: [{ citingPaperId: { in: ids } }, { citedPaperId: { in: ids } }] },
        select: { citingPaperId: true, citedPaperId: true },
      }),
    ])
  }

  return {
    sections,
    references,
    missing: references.filter((r) => !r.found).map((r) => r.paperId),
    evidence: buildManuscriptEvidence(ids, papers, noteRows, citationRows),
  }
}
