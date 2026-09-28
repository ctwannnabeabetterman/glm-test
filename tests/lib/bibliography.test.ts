import { describe, it, expect } from 'vitest'
import { detectBibliographyFormat, parseBibliography, parseRis, parseBibtex, paperIdentityKey } from '@/lib/library/bibliography'
import { buildPaperMarkdown, buildPapersCsv, csvEscape, sanitizeFilename } from '@/lib/library/paper-notes'
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
    expect(recs[0].zoteroKey).toBe('') // citation key != Zotero item key
  })

  it('never turns a BibTeX citation key into a Zotero identity', () => {
    const [item] = parseBibtex('@article{ABC123, title={Different Work}, year={2022}}')
    expect(item.zoteroKey).toBe('')
    expect(paperIdentityKey(item)).toBe('title:different work')
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

/**
 * CSV 公式注入 —— 2026-09-28 补的**唯一真实存在的注入面**加固。
 *
 * 论文标题/作者来自 Crossref / Zotero / BibTeX（外部输入），
 * 用户只是「导入一篇文献」；打开导出表格时不该执行别人写的东西。
 * SQL 侧没有这个面（全走 Prisma 参数化、无裸 SQL），命令侧也没有（无 shell 调用）。
 */
describe('CSV 公式注入：外部来的标题不能变成公式', () => {
  const cases: Array<[string, string]> = [
    ['=HYPERLINK("http://evil","点我")', "'=HYPERLINK"],
    ['+1+1', "'+1+1"],
    ['@SUM(A1:A9)', "'@SUM"],
    ['-2+3', "'-2+3"],
    ['\tDDE', "'\tDDE"],
  ]

  it.each(cases)('%s → 前置单引号中和', (raw, expectPrefix) => {
    expect(csvEscape(raw)).toContain(expectPrefix)
  })

  it('⚠️ 合法负数不加前缀（否则扫参导出的数值会变成文本、毁掉后续计算）', () => {
    expect(csvEscape(-5)).toBe('-5')
    expect(csvEscape('-3.5')).toBe('-3.5')
    expect(csvEscape('-3.5e2')).toBe('-3.5e2')
  })

  it('普通文本与既有转义规则都不受影响', () => {
    expect(csvEscape('Paper A')).toBe('Paper A')
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape(null)).toBe('')
  })

  it('端到端：恶意标题经 buildPapersCsv 出来仍是文本，不是公式', () => {
    const csv = buildPapersCsv(
      [{ Title: '=HYPERLINK("http://evil","click")', Authors: 'Zhang' }],
      ['Title', 'Authors'],
    )
    // 含逗号的单元格会加引号 ⇒ 前缀单引号在引号内，Excel 仍按文本处理
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).not.toMatch(/^=HYPERLINK/m)
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

  it('Zotero 的 abstractNote 落到 abstract 列，不污染用户自己的 notes', () => {
    const rec = mapZoteroItem({
      key: 'ABS1',
      data: {
        itemType: 'journalArticle',
        title: 'With abstract',
        abstractNote: 'This paper proposes a routing scheme.',
      },
    })
    expect(rec?.abstract).toBe('This paper proposes a routing scheme.')
    // 关键：摘要不能跑到 notes 里 —— notes 是用户手写的阅读笔记，
    // 被同步覆盖或混入摘要都属于数据污染（2026-09-18 修复前就是这个行为）
    expect(rec?.notes).toBe('')
  })
})

describe('bibliography parser —— 摘要与笔记必须分开', () => {
  it('RIS 的 AB 进 abstract，N1 进 notes', () => {
    const ris = [
      'TY  - JOUR',
      'TI  - Routing with DRL',
      'AB  - We propose a novel routing algorithm based on DQN.',
      'N1  - 这方法能不能用在 RIS 上？',
      'ER  - ',
    ].join('\n')
    const [rec] = parseRis(ris)
    expect(rec.abstract).toBe('We propose a novel routing algorithm based on DQN.')
    expect(rec.notes).toBe('这方法能不能用在 RIS 上？')
    // 修复前 AB 会被塞进 notes，导致摘要和用户笔记糊在一起
    expect(rec.notes).not.toContain('novel routing algorithm')
  })

  it('RIS 只有 AB 时 notes 保持为空', () => {
    const ris = ['TY  - JOUR', 'TI  - T', 'AB  - Only abstract here.', 'ER  - '].join('\n')
    const [rec] = parseRis(ris)
    expect(rec.abstract).toBe('Only abstract here.')
    expect(rec.notes).toBe('')
  })

  it('BibTeX 的 abstract 进 abstract，note 进 notes', () => {
    const bib = `@article{k1,
  title = {Routing with DRL},
  abstract = {We propose a DQN-based scheme.},
  note = {读的时候注意 baseline 选择},
}`
    const [rec] = parseBibtex(bib)
    expect(rec.abstract).toBe('We propose a DQN-based scheme.')
    expect(rec.notes).toBe('读的时候注意 baseline 选择')
  })

  it('BibTeX 只有 abstract 时 notes 保持为空（不再回退到 abstract）', () => {
    const bib = `@article{k2, title={T}, abstract={Only abstract body.}}`
    const [rec] = parseBibtex(bib)
    expect(rec.abstract).toBe('Only abstract body.')
    expect(rec.notes).toBe('')
  })
})
