import { normalizeSections, totalWords, type DraftSection } from './draft'

/** 发给前端的稿件结构：sections 已解析、字数已算好，前端不需要再理解 JSON 字符串 */
export interface ManuscriptDto {
  id: string
  title: string
  venue: string
  targetWords: number
  status: string
  sections: DraftSection[]
  words: number
  createdAt: Date | string
  updatedAt: Date | string
}

export interface ManuscriptRowLike {
  id: string
  title: string
  venue: string
  targetWords: number
  sections: string
  status: string
  createdAt: Date | string
  updatedAt: Date | string
}

export function toManuscriptDto(row: ManuscriptRowLike): ManuscriptDto {
  const sections = normalizeSections(row.sections)
  return {
    id: row.id,
    title: row.title,
    venue: row.venue,
    targetWords: row.targetWords,
    status: row.status,
    sections,
    words: totalWords(sections),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
