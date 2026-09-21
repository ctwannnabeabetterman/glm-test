import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/api/citations` 的统计口径契约。
 *
 * 这里修的是一个**真实存在过的自相矛盾**：接口把「指向已删除论文」的引用关系过滤掉了，
 * 却用**过滤前**的条数填 `stats.totalCitations` —— 于是界面上会出现
 * 「引用关系 3」而列表区写着「暂无引用关系」。用户既看不出原因（删论文不会连带删关系），
 * 也没有任何提示。这类「数字与内容不一致」比报错更难发现。
 */

const dbMock = vi.hoisted(() => {
  const make = () => ({
    findMany: vi.fn(async () => [] as unknown[]),
    findUnique: vi.fn(async () => null as unknown),
    count: vi.fn(async () => 0),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  })
  type Model = ReturnType<typeof make>
  const models: Record<string, Model> = {}
  const get = (key: string): Model => {
    if (!models[key]) models[key] = make()
    return models[key]
  }
  return {
    get,
    db: new Proxy({} as Record<string, Model>, { get: (_t, p) => get(String(p)) }),
  }
})

vi.mock('@/lib/db', () => ({ db: dbMock.db }))

const P = (id: string) => ({
  id,
  title: `Title ${id}`,
  authors: 'A',
  venue: 'V',
  year: 2024,
})

const C = (id: string, citing: string, cited: string) => ({
  id,
  citingPaperId: citing,
  citedPaperId: cited,
  context: '',
  createdAt: new Date(0),
})

beforeEach(() => {
  for (const name of ['citation', 'paper']) {
    const m = dbMock.get(name)
    m.findMany.mockReset()
    m.findMany.mockResolvedValue([])
  }
})

describe('GET /api/citations', () => {
  it('统计口径与列表一致，并把被隐藏的孤儿关系如实报出', async () => {
    dbMock.get('citation').findMany.mockResolvedValue([
      C('c1', 'p1', 'p2'), // 两篇都在库中
      C('c2', 'p1', 'gone'), // 被引方已删除
      C('c3', 'gone', 'p2'), // 引用方已删除
    ])
    dbMock.get('paper').findMany.mockResolvedValue([P('p1'), P('p2')])

    const { GET } = await import('@/app/api/citations/route')
    const body = await (await GET()).json()

    // 只留得下确实存在的关系
    expect(body.citations.map((c: { id: string }) => c.id)).toEqual(['c1'])
    // ⚠️ 关键：数字必须跟着列表走，而不是过滤前的 3
    expect(body.stats.totalCitations).toBe(1)
    expect(body.stats.orphanCitations).toBe(2)
    // 排行也只按确实存在的关系算
    expect(body.topCited.map((p: { id: string }) => p.id).sort()).toEqual(['p1', 'p2'])
    expect(body.topCited.find((p: { id: string }) => p.id === 'p1').citesCount).toBe(1)
  })

  it('孤儿关系被隐藏时，不把「引用方」的计数算进去（否则排行会虚高）', async () => {
    dbMock.get('citation').findMany.mockResolvedValue([
      C('c1', 'p1', 'gone'), // p1 引用的那篇已删除
    ])
    dbMock.get('paper').findMany.mockResolvedValue([P('p1')])

    const { GET } = await import('@/app/api/citations/route')
    const body = await (await GET()).json()
    expect(body.citations).toEqual([])
    expect(body.stats.totalCitations).toBe(0)
    expect(body.stats.orphanCitations).toBe(1)
    // p1 不再显示「引用 1」—— 因为它那条关系在界面上根本看不到
    expect(body.topCited).toEqual([])
  })

  it('全部健康时 orphanCitations 为 0', async () => {
    dbMock.get('citation').findMany.mockResolvedValue([C('c1', 'p1', 'p2')])
    dbMock.get('paper').findMany.mockResolvedValue([P('p1'), P('p2')])
    const { GET } = await import('@/app/api/citations/route')
    const body = await (await GET()).json()
    expect(body.stats).toMatchObject({ totalCitations: 1, papersWithCitations: 2, orphanCitations: 0 })
  })
})
