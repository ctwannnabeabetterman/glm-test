import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * `PUT /api/papers/[id]` 的**可写字段白名单**。
 *
 * 原来这里是 `data = { ...body }`：请求体里有什么就写什么 —— 连 `id` / `createdAt` 都能改，
 * 而且不会有任何报错（Prisma 照单全收）。同类缺陷的可怕之处在于它**平时完全看不出来**：
 * 本机 UI 只发合法字段，所以测试、类型检查、e2e 都不会红，直到某天一次手写 curl、
 * 一个同步脚本或一次重构多传了一个字段，把主键/时间戳写坏。
 *
 * 这里就守住两件事：① 白名单外的字段一律不落库；② 白名单**内**的字段与既有行为完全一致
 * （dateRead 自动维护、分数改动摘掉 AI 标记），别为了收紧顺手改坏正常路径。
 */

const dbMock = vi.hoisted(() => {
  const make = () => ({
    findMany: vi.fn(async () => [] as unknown[]),
    findUnique: vi.fn(async () => null as unknown),
    count: vi.fn(async () => 0),
    create: vi.fn(async (args: unknown) => args),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'p1', ...args.data })),
    upsert: vi.fn(async () => ({})),
    delete: vi.fn(),
  })
  type Model = ReturnType<typeof make>
  const models: Record<string, Model> = {}
  const get = (key: string): Model => {
    if (!models[key]) models[key] = make()
    return models[key]
  }
  return { get, db: new Proxy({} as Record<string, Model>, { get: (_t, p) => get(String(p)) }) }
})

vi.mock('@/lib/db', () => ({ db: dbMock.db }))

function put(body: unknown, id = 'p1') {
  const req = new NextRequest(`http://localhost/api/papers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { req, ctx: { params: Promise.resolve({ id }) } }
}

const updateData = () => dbMock.get('paper').update.mock.calls[0][0].data

beforeEach(() => {
  for (const name of ['paper', 'setting']) {
    const m = dbMock.get(name)
    m.update.mockClear()
    m.findUnique.mockClear()
    m.findUnique.mockResolvedValue(null)
    m.upsert.mockClear()
  }
})

describe('白名单：只透传允许修改的列', () => {
  it('主键与时间戳即使出现在请求体里也不会被写入', async () => {
    const { PUT } = await import('@/app/api/papers/[id]/route')
    const { req, ctx } = put({
      title: '新标题',
      relevance: 9,
      id: 'hacked-id',
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
      dateAdded: '1970-01-01T00:00:00.000Z',
    })
    await PUT(req, ctx)
    expect(updateData()).toEqual({ title: '新标题', relevance: 9 })
  })

  it('完全无关的字段被忽略，而不是让整个请求 500', async () => {
    const { PUT } = await import('@/app/api/papers/[id]/route')
    const { req, ctx } = put({ title: 'A', nonsense: 1, __proto__: null })
    const res = await PUT(req, ctx)
    expect(res.status).toBe(200)
    expect(updateData()).toEqual({ title: 'A' })
  })

  it('正常路径不受影响：数值字段照旧被转成数字', async () => {
    const { PUT } = await import('@/app/api/papers/[id]/route')
    const { req, ctx } = put({ year: '2023', citations: '120', relevance: '8', novelty: '7', readingTime: '3600' })
    await PUT(req, ctx)
    expect(updateData()).toEqual({ year: 2023, citations: 120, relevance: 8, novelty: 7, readingTime: 3600 })
  })
})

describe('白名单：既有行为原样保留', () => {
  it('status=read 自动补 dateRead；切到别的状态则清空', async () => {
    const { PUT } = await import('@/app/api/papers/[id]/route')

    const a = put({ status: 'read' })
    await PUT(a.req, a.ctx)
    expect(updateData().dateRead).toBeInstanceOf(Date)

    dbMock.get('paper').update.mockClear()
    const b = put({ status: 'reading' })
    await PUT(b.req, b.ctx)
    expect(updateData().dateRead).toBeNull()
  })

  it('改过相关度/新颖度/优先级 ⇒ 会去读一次「AI 来源标记」准备摘掉它', async () => {
    const { PUT } = await import('@/app/api/papers/[id]/route')
    const { req, ctx } = put({ relevance: 3 })
    await PUT(req, ctx)
    expect(dbMock.get('setting').findUnique).toHaveBeenCalled()
  })

  it('没动分数时不去碰来源标记（避免误摘）', async () => {
    const { PUT } = await import('@/app/api/papers/[id]/route')
    const { req, ctx } = put({ title: '只改标题' })
    await PUT(req, ctx)
    expect(dbMock.get('setting').findUnique).not.toHaveBeenCalled()
  })

  it('notes / topicIds / readingProgress 这类 JSON 字符串原样透传（不做二次序列化）', async () => {
    const { PUT } = await import('@/app/api/papers/[id]/route')
    const { req, ctx } = put({ notes: '# 笔记', topicIds: '["t1"]', readingProgress: '{"pass1":true}' })
    await PUT(req, ctx)
    expect(updateData()).toEqual({ notes: '# 笔记', topicIds: '["t1"]', readingProgress: '{"pass1":true}' })
  })
})
