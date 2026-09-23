import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { normalizeRecords } from '@/lib/library/bibliography'

/**
 * 「相关论文一键入库」的落库路径。
 *
 * 背景：AI 相关论文面板背后是 **Crossref 真实检索**，返回的
 * `{ title, authors, year, venue, doi, url }` 与论文库需要的字段完全对得上，
 * 但此前 UI 只给一个 DOI 外链 —— 用户拿着可用文献还要手动再录一遍。
 *
 * 为什么直接收结构化 `records` 而不是让前端拼 RIS：拼文本再让服务端解析回来，
 * 中间要处理 RIS 的换行与转义，任何一处没转干净就**静默丢字段**
 * （少了 DOI 就去重失败、少了作者就填错作者）。直接收对象没有这层损耗。
 */

const mergeMock = vi.hoisted(() => ({
  // 显式声明入参类型：否则 `mock.calls[0][0]` 会被收成 never，断言反而看不出问题
  mergeBibliography: vi.fn(async (records: unknown[]) => {
    void records
    return { created: 3, updated: 0, skipped: 0, abstracts: 0 }
  }),
}))

const activityMock = vi.hoisted(() => ({
  recordActivity: vi.fn(async (input: unknown) => {
    void input
  }),
}))

vi.mock('@/lib/library/merge', () => mergeMock)
vi.mock('@/lib/activity', () => activityMock)

function post(body: unknown) {
  return new NextRequest('http://localhost/api/papers/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mergedRecords = () => mergeMock.mergeBibliography.mock.calls[0][0] as unknown[]

beforeEach(() => {
  mergeMock.mergeBibliography.mockClear()
  mergeMock.mergeBibliography.mockResolvedValue({ created: 3, updated: 0, skipped: 0, abstracts: 0 })
  activityMock.recordActivity.mockClear()
})

describe('normalizeRecords：客户端来的东西一律不可信', () => {
  it('正常条目映射到 BibliographyRecord 的十个字段', () => {
    const out = normalizeRecords([
      { title: 'A Paper', authors: 'Zhang, L.', year: 2024, venue: 'IEEE TWC', doi: '10.1/x', url: 'https://doi.org/10.1/x' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      title: 'A Paper',
      authors: 'Zhang, L.',
      year: 2024,
      venue: 'IEEE TWC',
      doi: '10.1/x',
      url: 'https://doi.org/10.1/x',
      tags: '',
      notes: '',
      abstract: '',
      zoteroKey: '',
    })
  })

  it('丢弃无标题的条目（没有标题的文献入库后无法辨认）', () => {
    const out = normalizeRecords([{ title: '' }, { title: '   ' }, { authors: 'someone' }, {}])
    expect(out).toEqual([])
  })

  it('丢弃非对象元素，而不是整个请求失败', () => {
    const out = normalizeRecords([null, 42, 'text', undefined, { title: '好条目' }])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('好条目')
  })

  it('非数组入参 → 空数组（不抛）', () => {
    expect(normalizeRecords(undefined)).toEqual([])
    expect(normalizeRecords(null)).toEqual([])
    expect(normalizeRecords({ title: 'x' })).toEqual([])
    expect(normalizeRecords('[]')).toEqual([])
  })

  it('year 只接受有限正数，其余回落 0（由 schema 默认值兜底）', () => {
    const out = normalizeRecords([
      { title: 'a', year: '2023' },
      { title: 'b', year: -1 },
      { title: 'c', year: Number.NaN },
      { title: 'd', year: 'unknown' },
      { title: 'e', year: 2024.7 },
    ])
    expect(out.map((r) => r.year)).toEqual([2023, 0, 0, 0, 2024])
  })

  it('超长字段被截断（防止把整页 HTML 塞进 tags）', () => {
    const out = normalizeRecords([{ title: 'a', tags: 'x'.repeat(5000), abstract: 'y'.repeat(20000) }])
    expect(out[0].tags.length).toBe(500)
    expect(out[0].abstract.length).toBe(8000)
  })

  it('数字型字段被转成字符串而不是丢掉', () => {
    const out = normalizeRecords([{ title: 2024 }])
    expect(out[0].title).toBe('2024')
  })
})

describe('POST /api/papers/import：接受结构化 records', () => {
  it('records 走 mergeBibliography，并把统计原样回给前端', async () => {
    const { POST } = await import('@/app/api/papers/import/route')
    mergeMock.mergeBibliography.mockResolvedValue({ created: 5, updated: 1, skipped: 2, abstracts: 3 })
    const res = await POST(
      post({ records: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }, { title: 'E' }] }),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(mergedRecords()).toHaveLength(5)
    expect(json).toMatchObject({ success: true, parsed: 5, created: 5, updated: 1, skipped: 2 })
  })

  it('records 全被丢弃、且没有 text 时 → 400，不会拿空数组去 merge', async () => {
    const { POST } = await import('@/app/api/papers/import/route')
    const res = await POST(post({ records: [{ authors: '无标题' }] }))
    expect(res.status).toBe(400)
    expect(mergeMock.mergeBibliography).not.toHaveBeenCalled()
  })

  it('没有 records 时回落到 RIS / BibTeX 文本（老路径不受影响）', async () => {
    const { POST } = await import('@/app/api/papers/import/route')
    const ris = ['TY  - JOUR', 'TI  - From RIS', 'PY  - 2024', 'ER  - '].join('\n')
    const res = await POST(post({ text: ris }))
    expect(res.status).toBe(200)
    expect(mergedRecords()).toHaveLength(1)
    expect((mergedRecords()[0] as { title: string }).title).toBe('From RIS')
  })

  it('全空入参 → 400', async () => {
    const { POST } = await import('@/app/api/papers/import/route')
    const res = await POST(post({}))
    expect(res.status).toBe(400)
  })

  it('确有新增时记一条埋点；一条都没新增时不记（避免反复导入把时间线刷满）', async () => {
    const { POST } = await import('@/app/api/papers/import/route')

    activityMock.recordActivity.mockClear()
    await POST(post({ records: [{ title: 'A' }] }))
    expect(activityMock.recordActivity).toHaveBeenCalledTimes(1)
    expect(activityMock.recordActivity.mock.calls[0][0]).toMatchObject({ module: 'paper', action: 'import' })

    activityMock.recordActivity.mockClear()
    // 命中已有条目走的是 updated（合并元数据）而不是 created —— 这种「重复导入」不该刷埋点
    mergeMock.mergeBibliography.mockResolvedValue({ created: 0, updated: 3, skipped: 0, abstracts: 0 })
    await POST(post({ records: [{ title: 'A' }] }))
    expect(activityMock.recordActivity).not.toHaveBeenCalled()
  })
})
