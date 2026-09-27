import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeBibliography } from '@/lib/library/merge'
import { describeConflicts } from '@/lib/library/merge-conflicts'
import { parseBibtex, type BibliographyRecord } from '@/lib/library/bibliography'

const dbMock = vi.hoisted(() => {
  type Paper = { id: string; title: string; doi: string; zoteroKey: string; tags: string; notes: string; abstract: string; pdfUrl: string }
  const papers: Paper[] = []
  const findMany = vi.fn(async () => papers.map((p) => ({ ...p })))
  const create = vi.fn(async ({ data }: { data: Omit<Paper, 'id'> }) => {
    const paper = { ...data, id: `p${papers.length + 1}` }
    papers.push(paper)
    return { ...paper }
  })
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Paper> }) => {
    const paper = papers.find((p) => p.id === where.id)!
    Object.assign(paper, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)))
    return { ...paper }
  })
  return { papers, findMany, create, update }
})
vi.mock('@/lib/db', () => ({ db: { paper: dbMock } }))

const paper = (id: string, title: string, rest: Partial<(typeof dbMock.papers)[number]> = {}) => ({
  id, title, doi: '', zoteroKey: '', tags: '', notes: '', abstract: '', pdfUrl: '', ...rest,
})
const rec = (title: string, rest: Partial<BibliographyRecord> = {}): BibliographyRecord => ({
  title, doi: '', zoteroKey: '', tags: '', notes: '', abstract: '', url: '', authors: '', venue: '', year: 0, ...rest,
})

beforeEach(() => {
  dbMock.papers.length = 0
  dbMock.create.mockClear()
  dbMock.update.mockClear()
})

describe('merge bibliography · identity and in-batch state', () => {
  it('enriches one hand-entered title with DOI, then matches the new DOI without losing tags or abstract', async () => {
    dbMock.papers.push(paper('manual', '  A: Paper! ', { notes: 'my notes' }))
    expect(await mergeBibliography([
      rec('a paper', { doi: ' 10.1/ABC ', tags: 'first', abstract: 'abstract' }),
      rec('another title', { doi: '10.1/abc', tags: 'second', abstract: 'different' }),
    ])).toEqual({ created: 0, updated: 2, skipped: 0, abstracts: 1, conflicts: [] })
    expect(dbMock.papers).toHaveLength(1)
    expect(dbMock.papers[0]).toMatchObject({ tags: 'first, second', abstract: 'abstract', notes: 'my notes' })
  })

  it('indexes newly created titles and retains in-batch updates across three duplicate records', async () => {
    expect(await mergeBibliography([
      rec('New Paper', { tags: 'one' }),
      rec('new-paper', { tags: 'two', doi: '10.1/new' }),
      rec('New Paper', { tags: 'three', doi: '10.1/NEW' }),
    ])).toEqual({ created: 1, updated: 2, skipped: 0, abstracts: 0, conflicts: [] })
    expect(dbMock.papers).toHaveLength(1)
    expect(dbMock.papers[0].tags).toBe('one, two, three')
  })

  it('skips same-title different-DOI and ambiguous exact-title matches without modifying data', async () => {
    dbMock.papers.push(paper('a', 'Shared Title', { doi: '10.1/a' }))
    dbMock.papers.push(paper('b', 'Shared Title', { doi: '10.1/b' }))
    const stats = await mergeBibliography([rec('Shared Title', { doi: '10.1/c' }), rec('Shared Title')])
    expect(stats).toMatchObject({ created: 0, updated: 0, skipped: 2, abstracts: 0 })
    expect(dbMock.update).not.toHaveBeenCalled()
    expect(dbMock.create).not.toHaveBeenCalled()
    // ⚠️ 这条断言是本文件最重要的回归点：这类条目**不会被写入**，
    // 所以必须**被报出来**。此前只是悄悄 skipped++，用户看到「导入了却没出现」且毫无线索。
    expect(stats.conflicts).toHaveLength(2)
    expect(stats.conflicts[0]).toMatchObject({ title: 'Shared Title' })
    expect(stats.conflicts[0].reason).toContain('同名')
    expect(stats.conflicts[1].reason).toContain('同名')
  })

  it('rejects conflicting strong keys even when one DOI matches and the other key belongs to another paper', async () => {
    dbMock.papers.push(paper('a', 'A', { doi: '10.1/a', zoteroKey: 'ZA' }))
    dbMock.papers.push(paper('b', 'B', { zoteroKey: 'ZB' }))
    const stats = await mergeBibliography([
      rec('A', { doi: '10.1/a', zoteroKey: 'ZB' }),
      rec('A', { doi: '10.1/other' }),
      rec('B', { zoteroKey: 'ZB', doi: '10.1/a' }),
    ])
    expect(stats.skipped).toBe(3)
    expect(stats.conflicts).toHaveLength(3)
    expect(dbMock.update).not.toHaveBeenCalled()
  })

  it('skips old citation-key-like Zotero identities when their titles disagree', async () => {
    dbMock.papers.push(paper('old', 'Old Imported Citation', { zoteroKey: 'ABC123' }))
    const stats = await mergeBibliography([rec('Different Work', { zoteroKey: 'ABC123' })])
    expect(stats).toMatchObject({ created: 0, updated: 0, skipped: 1, abstracts: 0 })
    expect(dbMock.update).not.toHaveBeenCalled()
    expect(stats.conflicts[0].reason).toContain('标题不同')
  })

  it('does not merge a BibTeX citation key with a different Zotero item', async () => {
    dbMock.papers.push(paper('zotero', 'Actual Zotero Work', { zoteroKey: 'ABC123' }))
    const records = parseBibtex('@article{ABC123, title={Different Work}, year={2022}}')
    expect(await mergeBibliography(records)).toEqual({ created: 1, updated: 0, skipped: 0, abstracts: 0, conflicts: [] })
    expect(dbMock.papers[0].title).toBe('Actual Zotero Work')
    expect(dbMock.papers[1].zoteroKey).toBe('')
  })

  it('does not merge on a merely similar title or an empty normalized title', async () => {
    dbMock.papers.push(paper('a', 'Paper One'))
    const stats = await mergeBibliography([rec('Paper Two'), rec('...')])
    expect(stats).toMatchObject({ created: 1, updated: 0, skipped: 1, abstracts: 0 })
    // 「没有标题被丢弃」与「身份冲突」是两回事：前者是脏输入，不该出现在冲突提示里，
    // 否则用户会去论文库里找一条根本不存在的记录。
    expect(stats.conflicts).toEqual([])
  })
})

describe('describeConflicts · 冲突提示的措辞', () => {
  it('无冲突时返回 null（调用方据此决定要不要弹提示）', () => {
    expect(describeConflicts([])).toBeNull()
    expect(describeConflicts(undefined)).toBeNull()
  })

  it('列出标题与原因，并说明「未导入」而不是含糊的「已跳过」', () => {
    const text = describeConflicts([{ title: 'Same Title', reason: '库中已存在同名文献' }])!
    expect(text).toContain('「Same Title」')
    expect(text).toContain('未导入')
    expect(text).toContain('库中已存在同名文献')
  })

  it('超过上限时折叠成「等 N 条」，不把几十个标题铺满屏幕', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, reason: 'r' }))
    const text = describeConflicts(many, 2)!
    expect(text).toContain('「T0」')
    expect(text).toContain('「T1」')
    expect(text).not.toContain('「T2」')
    expect(text).toContain('等 5 条')
  })
})
