import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// In-memory transaction stand-in: no Prisma client or real database is opened.
const mock = vi.hoisted(() => {
  const sessions = new Map<string, { id: string; paperId: string; paperTitle: string; duration: number; date: Date }>()
  const papers = new Map<string, { id: string; title: string; readingTime: number }>()
  const readingSession = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null),
    create: vi.fn(async ({ data }: { data: { id: string; paperId: string; paperTitle: string; duration: number } }) => {
      if (sessions.has(data.id)) throw new Error('duplicate id')
      const session = { ...data, date: new Date() }
      sessions.set(data.id, session)
      return session
    }),
  }
  const paper = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => papers.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { readingTime: { increment: number } } }) => {
      const row = papers.get(where.id)!
      row.readingTime += data.readingTime.increment
      return { readingTime: row.readingTime }
    }),
  }
  const transactionClient = { paper, readingSession }
  return {
    sessions, papers, paper, readingSession,
    db: { $transaction: vi.fn(async (fn: (client: typeof transactionClient) => unknown) => {
      const previousSessions = new Map(sessions)
      const previousPapers = new Map([...papers].map(([id, row]) => [id, { ...row }]))
      try {
        return await fn(transactionClient)
      } catch (error) {
        sessions.clear()
        for (const [id, row] of previousSessions) sessions.set(id, row)
        papers.clear()
        for (const [id, row] of previousPapers) papers.set(id, row)
        throw error
      }
    }) },
  }
})

vi.mock('@/lib/db', () => ({ db: mock.db }))

const post = (body: unknown) => new NextRequest('http://localhost/api/reading-sessions', {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => {
  mock.sessions.clear()
  mock.papers.clear()
  mock.papers.set('p1', { id: 'p1', title: '原论文', readingTime: 1000 })
  mock.readingSession.create.mockClear()
  mock.paper.update.mockClear()
})

describe('POST /api/reading-sessions', () => {
  it('首次分段原子记录会话并增量维护既有累计，重试同 id 不重复计时', async () => {
    const { POST } = await import('@/app/api/reading-sessions/route')
    const segment = { id: 'seg-1', paperId: 'p1', duration: 30, paperTitle: '篡改标题' }
    const first = await POST(post(segment))
    expect(first.status).toBe(201)
    expect(await first.json()).toMatchObject({ paperTitle: '原论文', totalSeconds: 1030 })
    expect((await POST(post(segment))).status).toBe(200)
    expect(mock.readingSession.create).toHaveBeenCalledTimes(1)
    expect(mock.paper.update).toHaveBeenCalledTimes(1)
    expect(mock.papers.get('p1')?.readingTime).toBe(1030)
    expect(mock.sessions.get('seg-1')?.duration).toBe(30)
  })

  it('双窗口相同基数分别写增量，暂停/停止不同段各算一次', async () => {
    const { POST } = await import('@/app/api/reading-sessions/route')
    await POST(post({ id: 'window-a-pause', paperId: 'p1', duration: 10 }))
    await POST(post({ id: 'window-b', paperId: 'p1', duration: 20 }))
    await POST(post({ id: 'window-a-stop', paperId: 'p1', duration: 5 }))
    expect(mock.papers.get('p1')?.readingTime).toBe(1035)
    expect(mock.sessions.size).toBe(3)
  })

  it('同 id 不同载荷冲突且缺失论文/非法时不创建孤儿会话', async () => {
    const { POST } = await import('@/app/api/reading-sessions/route')
    await POST(post({ id: 'seg-1', paperId: 'p1', duration: 7 }))
    expect((await POST(post({ id: 'seg-1', paperId: 'p1', duration: 8 }))).status).toBe(409)
    expect((await POST(post({ id: 'orphan', paperId: 'missing', duration: 7 }))).status).toBe(404)
    for (const duration of [-1, 0, 1.5, '30', 86401]) {
      expect((await POST(post({ id: 'bad', paperId: 'p1', duration }))).status).toBe(400)
    }
    expect(mock.sessions.size).toBe(1)
    expect(mock.papers.get('p1')?.readingTime).toBe(1007)
  })

  it('累计更新失败时整段回滚，同 id 可安全重试', async () => {
    const { POST } = await import('@/app/api/reading-sessions/route')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mock.paper.update.mockRejectedValueOnce(new Error('disk full'))
      const segment = { id: 'retry-id', paperId: 'p1', duration: 9 }
      expect((await POST(post(segment))).status).toBe(500)
      expect(mock.sessions.has('retry-id')).toBe(false)
      expect(mock.papers.get('p1')?.readingTime).toBe(1000)
      expect((await POST(post(segment))).status).toBe(201)
      expect(mock.papers.get('p1')?.readingTime).toBe(1009)
    } finally {
      log.mockRestore()
    }
  })
})
