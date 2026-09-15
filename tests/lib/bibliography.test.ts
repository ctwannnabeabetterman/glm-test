import { describe, it, expect } from 'vitest'
import { detectBibliographyFormat, parseBibliography, parseRis, parseBibtex, paperIdentityKey } from '@/lib/library/bibliography'
import { buildPaperMarkdown, buildPapersCsv, sanitizeFilename } from '@/lib/library/paper-notes'
import { mapZoteroItem } from '@/lib/library/zotero'

describe('RIS / BibTeX import', () => {
  it('parses a RIS journal record into list fields', () => {
    const ris = `TY  - JOUR
TI  - Deep Reinforcement Learning for Wireless Networks
AU  - Zhang, Wei
AU  - Li, Ming
PY  - 2024
JO  - IEEE TCOM
DO  - 10.1109/TCOM.2024.1
KW  - DRL
KW  - resource allocation
ER  - 
`
    const recs = parseRis(ris)
    expect(recs).toHaveLength(1)
    expect(recs[0].title).toBe('Deep Reinforcement Learning for Wireless Networks')
    expect(recs[0].authors).toContain('Zhang, Wei')
    expect(recs[0].year).toBe(2024)
    expect(recs[0].doi).toBe('10.1109/TCOM.2024.1')
    expect(recs[0].tags).toContain('DRL')
  })

  it('parses BibTeX and detects format', () => {
    const bib = `@article{zhang2024drl,
  title={A Survey of Semantic Communications},
  author={Chen, Li and Wang, Tao},
  journal={IEEE COMST},
  year={2023},
  doi={10.1109/COMST.2023.1},
}`
    expect(detectBibliographyFormat(bib)).toBe('bibtex')
    const recs = parseBibtex(bib)
    expect(recs[0].title).toBe('A Survey of Semantic Communications')
    expect(recs[0].authors).toContain('Chen, Li')
    expect(recs[0].year).toBe(2023)
  })

  it('returns empty on unknown text instead of inventing papers', () => {
    expect(parseBibliography('hello world')).toEqual([])
  })

  // 回归：旧实现用 /@\w+\s*\{[\s\S]*?\n\}/g，要求闭合 } 紧跟换行，
  // 导致「单行紧凑写法」一条都解析不出来。用户从网页/对话里粘贴时常是单行。
  it('parses a single-line BibTeX entry (regression)', () => {
    const bib = '@article{styleB, title={Compact One Line}, author={Gamma, Guy}, year={2026}}'
    const recs = parseBibtex(bib)
    expect(recs).toHaveLength(1)
    expect(recs[0].title).toBe('Compact One Line')
    expect(recs[0].authors).toBe('Gamma, Guy')
    expect(recs[0].year).toBe(2026)
  })

  it('parses a single-line BibTeX entry with spaces around the equals sign', () => {
    const bib = '@article{styleC, title = {Compact With Spaces}, author = {Delta, Dan}, year = {2026} }'
    const recs = parseBibtex(bib)
    expect(recs).toHaveLength(1)
    expect(recs[0].title).toBe('Compact With Spaces')
  })

  it('keeps nested braces inside field values intact', () => {
    const bib = '@article{nested, title = {A {B} C Survey}, author = {X, Y}, year = {2024}}'
    const recs = parseBibtex(bib)
    expect(recs).toHaveLength(1)
    // 非贪婪匹配会在值内的第一个 } 处提前截断，配平扫描则不会
    expect(recs[0].title).toBe('A B C Survey')
  })

  it('parses multiple entries mixing single-line and multi-line forms', () => {
    const bib = `@article{one, title={First Paper}, year={2020}}
@article{two,
  title = {Second Paper},
  year = {2021}
}`
    const recs = parseBibtex(bib)
    expect(recs).toHaveLength(2)
    expect(recs.map((r) => r.title)).toEqual(['First Paper', 'Second Paper'])
  })

  // 回归：字段名缺少左边界时，`title =` 会匹配到 `subtitle =` 里的 `title`
  it('does not mistake subtitle for title (field name boundary)', () => {
    const bib = '@article{boundary, title={Real Title}, subtitle={Should Not Win}, year={2024}}'
    const recs = parseBibtex(bib)
    expect(recs).toHaveLength(1)
    expect(recs[0].title).toBe('Real Title')
  })

  it('reads quoted field values', () => {
    const bib = '@article{q, title = "Quoted Title", author = "Quoted, Author", year = 2023}'
    const recs = parseBibtex(bib)
    expect(recs).toHaveLength(1)
    expect(recs[0].title).toBe('Quoted Title')
    expect(recs[0].year).toBe(2023)
  })

  it('identity prefers DOI over title', () => {
    expect(paperIdentityKey({ doi: '10.1/Abc', title: 'Hello' })).toBe('doi:10.1/abc')
  })
})

describe('paper note export', () => {
  it('markdown contains the reading notes, not just the title', () => {
    const md = buildPaperMarkdown({
      title: 'Demo Paper',
      authors: 'A. Author',
      venue: 'IEEE TCOM',
      year: 2024,
      notes: '核心方法是 DQN 功率控制。',
      tags: 'DRL, power',
    })
    expect(md).toContain('核心方法是 DQN 功率控制。')
    expect(md).toContain('Demo Paper')
    expect(md).toContain('#DRL')
  })

  it('CSV is a paper list with BOM and does not dump note body as the only column', () => {
    const csv = buildPapersCsv(
      [{ Title: 'Paper A', Authors: 'Zhang', Venue: 'TCOM', Year: 2024, Notes: 'should not be required' }],
      ['Title', 'Authors', 'Venue', 'Year']
    )
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('Title,Authors,Venue,Year')
    expect(csv).toContain('Paper A')
  })

  it('sanitizes filenames', () => {
    expect(sanitizeFilename('a/b:c*.pdf')).toBe('a_b_c_.pdf')
  })
})

describe('zotero mapper', () => {
  it('skips attachments and maps journal items', () => {
    expect(mapZoteroItem({ data: { itemType: 'attachment', title: 'file.pdf' } })).toBeNull()
    const rec = mapZoteroItem({
      key: 'ABC123',
      data: {
        itemType: 'journalArticle',
        title: 'GNN Routing',
        creators: [{ creatorType: 'author', firstName: 'Wei', lastName: 'Zhang' }],
        publicationTitle: 'IEEE TWC',
        date: '2022-05-01',
        DOI: '10.1109/TWC.2022.1',
        tags: [{ tag: 'GNN' }],
        key: 'ABC123',
      },
    })
    expect(rec?.title).toBe('GNN Routing')
    expect(rec?.authors).toBe('Zhang, Wei')
    expect(rec?.year).toBe(2022)
    expect(rec?.zoteroKey).toBe('ABC123')
  })
})
