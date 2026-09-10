/**
 * 文献导入解析 —— RIS / EndNote / BibTeX。
 * 纯函数，不调 LLM：导入后只写入论文列表字段，关系网络按标签/作者/分类自动刷新。
 */

export interface BibliographyRecord {
  title: string
  authors: string
  venue: string
  year: number
  doi: string
  tags: string
  notes: string
  url: string
  zoteroKey: string
}

const EMPTY: BibliographyRecord = {
  title: '',
  authors: '',
  venue: '',
  year: 0,
  doi: '',
  tags: '',
  notes: '',
  url: '',
  zoteroKey: '',
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function yearFrom(text: string): number {
  const m = text.match(/(19|20)\d{2}/)
  return m ? Number(m[0]) : 0
}

function joinAuthors(authors: string[]): string {
  return authors.map((a) => clean(a)).filter(Boolean).join(', ')
}

function joinTags(tags: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const v = clean(t)
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out.join(', ')
}

/** 解析 RIS / EndNote 导出（TY/TI/AU/PY/JO/T2/DO/KW/N1/UR） */
export function parseRis(text: string): BibliographyRecord[] {
  const records: BibliographyRecord[] = []
  let cur: BibliographyRecord | null = null
  const authors: string[] = []
  const tags: string[] = []

  const flush = () => {
    if (!cur) return
    cur.authors = joinAuthors(authors)
    cur.tags = joinTags(tags)
    if (cur.title) records.push({ ...cur })
    cur = null
    authors.length = 0
    tags.length = 0
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\uFEFF/g, '')
    const m = line.match(/^([A-Z][A-Z0-9])  - (.*)$/)
    if (!m) {
      if (cur && line.trim() && !line.startsWith('ER')) {
        cur.notes = cur.notes ? `${cur.notes}\n${line}` : line
      }
      continue
    }
    const [, tag, value] = m
    if (tag === 'TY') {
      flush()
      cur = { ...EMPTY }
      continue
    }
    if (!cur) cur = { ...EMPTY }
    if (tag === 'ER') {
      flush()
      continue
    }
    switch (tag) {
      case 'TI':
      case 'T1':
        cur.title = clean(value)
        break
      case 'AU':
      case 'A1':
        authors.push(value)
        break
      case 'PY':
      case 'Y1':
        cur.year = yearFrom(value) || cur.year
        break
      case 'JO':
      case 'T2':
      case 'JF':
      case 'BT':
        if (!cur.venue) cur.venue = clean(value)
        break
      case 'DO':
        cur.doi = clean(value)
        break
      case 'KW':
        tags.push(value)
        break
      case 'N1':
      case 'AB':
        cur.notes = cur.notes ? `${cur.notes}\n${value}` : value
        break
      case 'UR':
      case 'L1':
        if (!cur.url) cur.url = clean(value)
        break
      case 'ID':
        if (!cur.zoteroKey) cur.zoteroKey = clean(value)
        break
    }
  }
  flush()
  return records
}

function unbrace(s: string): string {
  return clean(s.replace(/[{}]/g, '').replace(/\\&/g, '&'))
}

/** 解析精简 BibTeX（@article/@inproceedings 等常见字段） */
export function parseBibtex(text: string): BibliographyRecord[] {
  const records: BibliographyRecord[] = []
  const entryRe = /@\w+\s*\{[\s\S]*?\n\}/g
  const chunks = text.match(entryRe) ?? []
  for (const chunk of chunks) {
    const rec: BibliographyRecord = { ...EMPTY }
    const field = (name: string) => {
      const re = new RegExp(`${name}\\s*=\\s*[{\"]([\\s\\S]*?)[}\"]\\s*,?`, 'i')
      const m = chunk.match(re)
      return m ? unbrace(m[1]) : ''
    }
    rec.title = field('title')
    rec.authors = field('author').replace(/\s+and\s+/gi, ', ')
    rec.venue = field('journal') || field('booktitle') || field('publisher')
    rec.year = yearFrom(field('year'))
    rec.doi = field('doi')
    rec.tags = field('keywords').replace(/;/g, ',')
    rec.notes = field('abstract') || field('note')
    rec.url = field('url')
    const keyMatch = chunk.match(/@\w+\s*\{([^,]+),/)
    if (keyMatch) rec.zoteroKey = clean(keyMatch[1])
    if (rec.title) records.push(rec)
  }
  return records
}

export function detectBibliographyFormat(text: string): 'ris' | 'bibtex' | 'unknown' {
  const head = text.slice(0, 400)
  if (/^\s*TY {2}- /m.test(head) || /\nTY {2}- /.test(text)) return 'ris'
  if (/@\w+\s*\{/.test(head) || /@\w+\s*\{/.test(text)) return 'bibtex'
  return 'unknown'
}

export function parseBibliography(text: string): BibliographyRecord[] {
  const fmt = detectBibliographyFormat(text)
  if (fmt === 'ris') return parseRis(text)
  if (fmt === 'bibtex') return parseBibtex(text)
  return []
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim()
}

export function paperIdentityKey(p: { doi?: string; zoteroKey?: string; title?: string }): string {
  const doi = (p.doi || '').trim().toLowerCase()
  if (doi) return `doi:${doi}`
  const zk = (p.zoteroKey || '').trim()
  if (zk) return `zotero:${zk}`
  return `title:${normalizeTitle(p.title || '')}`
}
