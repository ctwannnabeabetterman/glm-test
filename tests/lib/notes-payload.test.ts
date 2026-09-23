import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  NOTE_WRITABLE_FIELDS,
  parsePaperIds,
  pickWritableNote,
  toJsonArrayText,
  toLastReadAt,
  toStructuredText,
} from '@/lib/notes/payload'

/**
 * 笔记写入载荷（`lib/notes/payload.ts`）与两个笔记接口。
 *
 * 两件事一起守：
 *  ① **JSON 数组列的归一化** —— 前端有时传数组、有时传已序列化的字符串；
 *     而 `''` / 坏 JSON 必须回落成 `[]`，否则读取端的 `JSON.parse` 会抛错，
 *     表现为「笔记列表整个打不开」。这类脏数据一旦写进库就再也修不回来了。
 *  ② **`PUT /api/notes/[id]` 的白名单** —— 它原本是 `{ ...body }` 直通，
 *     `id`/`createdAt`/`updatedAt` 都能被前端覆盖且不报错，与 v1.3.12 修掉的
 *     `PUT /api/papers/[id]` 是同一个病。
 */

const dbMock = vi.hoisted(() => {
  const make = () => ({
    findMany: vi.fn(async () => [] as unknown[]),
    findUnique: vi.fn(async () => null as unknown),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'n1', ...args.data })),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'n1', ...args.data })),
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
vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn(async () => {}) }))

function put(body: unknown, id = 'n1') {
  const req = new NextRequest(`http://localhost/api/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { req, ctx: { params: Promise.resolve({ id }) } }
}

function post(body: unknown) {
  const req = new NextRequest('http://localhost/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return req
}

const updateData = () => dbMock.get('note').update.mock.calls[0][0].data
const createData = () => dbMock.get('note').create.mock.calls[0][0].data

beforeEach(() => {
  for (const name of ['note']) {
    const m = dbMock.get(name)
    m.update.mockClear()
    m.create.mockClear()
    m.findUnique.mockClear()
    m.findUnique.mockResolvedValue(null)
  }
})

describe('JSON 数组列归一化', () => {
  it('数组 → JSON 字符串', () => {
    expect(toJsonArrayText(['p1', 'p2'])).toBe('["p1","p2"]')
  })

  it('已序列化的字符串原样保留（不再包一层引号）', () => {
    expect(toJsonArrayText('["p1"]')).toBe('["p1"]')
    expect(toJsonArrayText('[]')).toBe('[]')
  })

  it('空串 / 全是空白 → 回落默认值（写进库会让读取端 JSON.parse 抛错）', () => {
    expect(toJsonArrayText('')).toBe('[]')
    expect(toJsonArrayText('   ')).toBe('[]')
    expect(toJsonArrayText(undefined)).toBe('[]')
    expect(toJsonArrayText(null)).toBe('[]')
  })

  it('坏 JSON、非数组 JSON、非字符串非数组 → 一律回落（不能抛）', () => {
    expect(toJsonArrayText('{not json')).toBe('[]')
    expect(toJsonArrayText('{"a":1}')).toBe('[]')
    expect(toJsonArrayText(42)).toBe('[]')
  })

  it('parsePaperIds 是它的读取侧对偶：脏数据当空数组，不炸页面', () => {
    expect(parsePaperIds('["p1","p2"]')).toEqual(['p1', 'p2'])
    expect(parsePaperIds(['p1'])).toEqual(['p1'])
    expect(parsePaperIds('')).toEqual([])
    expect(parsePaperIds('{bad')).toEqual([])
    expect(parsePaperIds(null)).toEqual([])
    // 数组里混进非字符串时只保留字符串
    expect(parsePaperIds('["p1",1,null]')).toEqual(['p1'])
  })
})

describe('structured / lastReadAt 归一化', () => {
  it('对象 → JSON 字符串；字符串原样保留（防二次编码）', () => {
    expect(toStructuredText({ a: '1' })).toBe('{"a":"1"}')
    expect(toStructuredText('{"a":"1"}')).toBe('{"a":"1"}')
  })

  it('空值回落 {}，坏类型不抛', () => {
    expect(toStructuredText(undefined)).toBe('{}')
    expect(toStructuredText('')).toBe('{}')
    expect(toStructuredText(7)).toBe('{}')
  })

  it('lastReadAt：真值转 Date、假值转 null（用于「取消最近阅读时间」）', () => {
    expect(toLastReadAt('2026-09-23T00:00:00.000Z')).toBeInstanceOf(Date)
    expect(toLastReadAt(null)).toBeNull()
    expect(toLastReadAt('')).toBeNull()
    expect(toLastReadAt('not-a-date')).toBeNull()
  })
})

describe('pickWritableNote：白名单挑字段', () => {
  it('白名单外的键被忽略', () => {
    const data = pickWritableNote({ title: 'A', id: 'hacked', createdAt: '1970-01-01', nonsense: 1 })
    expect(data).toEqual({ title: 'A' })
    expect(Object.keys(data)).not.toContain('id')
    expect(Object.keys(data)).not.toContain('createdAt')
  })

  it('未传的字段不进结果（让 Prisma 区分「没传」与「传了空值」）', () => {
    expect(pickWritableNote({ title: 'A' })).toEqual({ title: 'A' })
  })

  it('paperIds 也在白名单里，且走数组归一化', () => {
    expect(NOTE_WRITABLE_FIELDS).toContain('paperIds')
    expect(pickWritableNote({ paperIds: ['p1'] })).toEqual({ paperIds: '["p1"]' })
    expect(pickWritableNote({ paperIds: [] })).toEqual({ paperIds: '[]' })
  })
})

describe('PUT /api/notes/[id]：白名单真的生效', () => {
  it('主键与时间戳即使出现在请求体里也不会被写入', async () => {
    const { PUT } = await import('@/app/api/notes/[id]/route')
    const { req, ctx } = put({
      title: '改标题',
      paperIds: ['p1'],
      id: 'hacked-id',
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })
    await PUT(req, ctx)
    expect(updateData()).toEqual({ title: '改标题', paperIds: '["p1"]' })
  })

  it('一个可写字段都没有时不去 update（避免 Prisma 收到空 data 抛错），返回当前值', async () => {
    const { PUT } = await import('@/app/api/notes/[id]/route')
    dbMock.get('note').findUnique.mockResolvedValue({ id: 'n1', title: '原样' })
    const { req, ctx } = put({ id: 'x', createdAt: '1970-01-01' })
    const res = await PUT(req, ctx)
    expect(dbMock.get('note').update).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it('关联文献的保存路径原样可用（勾选即保存走的就是这条）', async () => {
    const { PUT } = await import('@/app/api/notes/[id]/route')
    const { req, ctx } = put({ paperIds: JSON.stringify(['p1', 'p2']) })
    await PUT(req, ctx)
    expect(updateData()).toEqual({ paperIds: '["p1","p2"]' })
  })
})

describe('POST /api/notes', () => {
  it('缺标题时返回 400（而不是让 Prisma 抛出一个谁也看不懂的 500）', async () => {
    const { POST } = await import('@/app/api/notes/route')
    const res = await POST(post({ content: '没有标题' }))
    expect(res.status).toBe(400)
    expect(dbMock.get('note').create).not.toHaveBeenCalled()
  })

  it('title 为空字符串同样按缺标题处理', async () => {
    const { POST } = await import('@/app/api/notes/route')
    const res = await POST(post({ title: '   ' }))
    expect(res.status).toBe(400)
  })

  it('新建时会带上全部 JSON 列的默认值（与 Prisma schema 的 @default 一致）', async () => {
    const { POST } = await import('@/app/api/notes/route')
    await POST(post({ title: '新笔记' }))
    expect(createData()).toMatchObject({
      title: '新笔记',
      links: '[]',
      structured: '{}',
      topicIds: '[]',
      paperIds: '[]',
      category: 'literature',
    })
  })

  it('AI 面板「存为笔记」的实际载荷能落库（含关联论文）', async () => {
    const { POST } = await import('@/app/api/notes/route')
    await POST(
      post({
        title: 'AI 快速摘要 · 某论文',
        content: '## 研究问题\n…',
        category: 'knowledge',
        paperIds: ['p1'],
      }),
    )
    expect(createData()).toMatchObject({
      title: 'AI 快速摘要 · 某论文',
      category: 'knowledge',
      paperIds: '["p1"]',
    })
  })
})
