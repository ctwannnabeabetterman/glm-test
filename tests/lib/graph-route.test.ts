import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  paper: { findMany: vi.fn() },
  topic: { findMany: vi.fn() },
  note: { findMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

type PaperRow = {
  id: string; title: string; year: number; venue: string
  relevance: number; novelty: number; authors: string; tags: string; category: string
}
const paperRow = (id: string, rest: Partial<PaperRow> = {}): PaperRow => ({
  id, title: `Paper ${id}`, year: 2026, venue: 'Venue', relevance: 5, novelty: 5,
  authors: 'Author', tags: '', category: 'method', ...rest,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('知识图谱容量与关系', () => {
  it('只取图谱需要的字段和有限节点；同类论文不构造完全图', async () => {
    dbMock.paper.findMany.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({
      id: `p${index}`, title: `Paper ${index}`, year: 2026, venue: 'Venue',
      relevance: 5, novelty: 5, authors: 'Author', tags: '', category: 'method',
    })))
    dbMock.topic.findMany.mockResolvedValue([])
    dbMock.note.findMany.mockResolvedValue([])
    const { GET } = await import('@/app/api/graph/route')
    const response = await GET()
    expect(response.status).toBe(200)
    const graph = await response.json()
    expect(graph.stats.totalNodes).toBe(100)
    expect(graph.edges).toHaveLength(99 + 98 + 97 + 96 + 95)
    expect(graph.edges.every((edge: { type: string }) => edge.type === 'same-category')).toBe(true)
    expect(dbMock.paper.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 101, select: expect.not.objectContaining({ abstract: true, notes: true }),
    }))
    expect(dbMock.topic.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 21 }))
    expect(dbMock.note.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 61 }))
  })

  it('超出上限时如实标记 truncated，且节点数被截到上限（不能悄悄画一半还装完整）', async () => {
    // `take: 101` 是「探测是否超限」的技巧：返回 101 行就说明库里有更多。
    const { GET } = await import('@/app/api/graph/route')
    dbMock.paper.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, i) => paperRow(`p${i}`)))
    dbMock.topic.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ id: `t${i}`, name: `Topic ${i}`, totalScore: 1, direction: '' })),
    )
    dbMock.note.findMany.mockResolvedValue([])
    const graph = await (await GET()).json()

    expect(graph.stats.truncated).toBe(true)
    expect(graph.stats.papers).toBe(100)
    expect(graph.stats.topics).toBe(20)
    expect(graph.nodes.filter((n: { type: string }) => n.type === 'paper')).toHaveLength(100)
    expect(graph.nodes.filter((n: { type: string }) => n.type === 'topic')).toHaveLength(20)
  })

  it('未超限时不留 truncated 假警报（否则界面会一直提示「数据不完整」）', async () => {
    // 课题词（长度 > 2）必须在论文标题/标签/作者里出现才会连边。
    dbMock.paper.findMany.mockResolvedValue([paperRow('a', { title: 'Time sync in arrays' }), paperRow('b')])
    dbMock.topic.findMany.mockResolvedValue([{ id: 't', name: 'Time Synchronization', totalScore: 3, direction: 'd' }])
    dbMock.note.findMany.mockResolvedValue([])
    const { GET } = await import('@/app/api/graph/route')
    const graph = await (await GET()).json()
    expect(graph.stats.truncated).toBe(false)
    // 顺带覆盖 topic-paper 关系：只有标题命中课题词的论文才连边。
    expect(graph.edges).toContainEqual({
      source: 'topic-t', target: 'paper-a', type: 'topic-paper', weight: 1,
    })
    expect(graph.edges.filter((e: { type: string }) => e.type === 'topic-paper')).toHaveLength(1)
  })

  it('共享标签优先于同分类，且每篇论文最多连 5 个相似邻居（边预算不随篇数平方膨胀）', async () => {
    const papers = [
      paperRow('a', { title: 'Alpha', tags: 'sync, array', category: 'method' }),
      paperRow('b', { title: 'Beta', tags: 'sync', category: 'method' }),
      ...Array.from({ length: 20 }, (_, i) => paperRow(`x${i}`, { title: `Extra ${i}`, category: 'method' })),
    ]
    dbMock.paper.findMany.mockResolvedValue(papers)
    dbMock.topic.findMany.mockResolvedValue([])
    dbMock.note.findMany.mockResolvedValue([])
    const { GET } = await import('@/app/api/graph/route')
    const graph = await (await GET()).json()

    // 共享标签的边权重 = 共同标签数，且类型是 shared-tag 而不是 same-category
    expect(graph.edges).toContainEqual({
      source: 'paper-a', target: 'paper-b', type: 'shared-tag', weight: 1,
    })
    // 每篇论文出边 ≤5：22 篇 ⇒ 最多 110 条（完全图会是 231 条）
    const byPaper = new Map<string, number>()
    for (const e of graph.edges) {
      if (e.type !== 'shared-tag' && e.type !== 'same-category') continue
      byPaper.set(e.source, (byPaper.get(e.source) ?? 0) + 1)
    }
    expect(Math.max(...byPaper.values())).toBeLessThanOrEqual(5)
    expect(graph.edges.filter((e: { type: string }) => e.type === 'same-category' || e.type === 'shared-tag').length)
      .toBeLessThanOrEqual(110)
  })
})

