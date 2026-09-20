import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 稿件导出：`?style=` 的行为契约。
 *
 * 为什么必须钉住：导出是「写作即引用」的最后一米。
 * 三种失败模式都不会报错、但都会让用户拿到错的稿子：
 *   - 未知 style 静默按 IEEE 导 —— 用户以为拿到 GB/T，投稿时被打回；
 *   - 预览用 GB/T、导出用 IEEE —— 两边不一致，肉眼很难发现；
 *   - 默认（不带 style）改变了旧行为 —— 已导出的稿子对不上。
 */

const dbMock = vi.hoisted(() => {
  const make = () => ({
    findMany: vi.fn(async () => [] as unknown[]),
    findUnique: vi.fn(async () => null as unknown),
    count: vi.fn(async () => 0),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
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

const MANUSCRIPT = {
  id: 'm1',
  title: '我的论文',
  venue: 'IEEE JSAC',
  targetWords: 0,
  sections: JSON.stringify([
    { id: 's1', title: 'Introduction', targetWords: 0, content: '路由问题 [@p1] 很重要。' },
  ]),
  status: 'draft',
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const PAPER = {
  id: 'p1',
  title: 'Deep RL for Routing',
  authors: 'Nasir, Y. S., Guo, D.',
  venue: 'IEEE JSAC',
  year: 2024,
  doi: '10.1/aaa',
}

function get(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/writing/manuscripts/m1/export${query}`)
}

async function loadRoute() {
  return import('@/app/api/writing/manuscripts/[id]/export/route')
}

const ctx = { params: Promise.resolve({ id: 'm1' }) }

beforeEach(() => {
  dbMock.get('manuscript').findUnique.mockResolvedValue(MANUSCRIPT)
  dbMock.get('paper').findMany.mockResolvedValue([PAPER])
})

describe('GET /api/writing/manuscripts/[id]/export?style=', () => {
  it('默认仍按 IEEE 导出（不带 style 时行为不变，旧的导出结果可复现）', async () => {
    const { GET } = await loadRoute()
    const res = await GET(get(''), ctx)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('## 参考文献')
    expect(text).toContain('[1] Y. S. Nasir, D. Guo, "Deep RL for Routing", IEEE JSAC, 2024. doi: 10.1/aaa.')
  })

  it('?style=gbt7714 整段换格式，正文编号不变', async () => {
    const { GET } = await loadRoute()
    const res = await GET(get('?style=gbt7714'), ctx)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('[1] NASIR Y S, GUO D. Deep RL for Routing[J]. IEEE JSAC, 2024. DOI:10.1/aaa.')
    expect(text).toContain('路由问题 [1] 很重要。')
    expect(text).not.toContain('"Deep RL for Routing"')
  })

  it('大小写不敏感（?style=GB/T7714 之类的前端拼写不做强要求）', async () => {
    const { GET } = await loadRoute()
    const res = await GET(get('?style=GBT7714'), ctx)
    // 只有精确的 'gbt7714' 是合法值；大小写归一后应命中
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('NASIR Y S')
  })

  it('未知 style → 400 且列出可选值（绝不静默回退成 IEEE）', async () => {
    const { GET } = await loadRoute()
    const res = await GET(get('?style=mla'), ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unsupported style')
    expect(body.supported).toEqual(['ieee', 'gbt7714'])
  })

  it('txt 导出同样带样式（不是只有 md 生效）', async () => {
    const { GET } = await loadRoute()
    const res = await GET(get('?format=txt&style=gbt7714'), ctx)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('NASIR Y S')
    expect(text).not.toContain('## 参考文献') // txt 去掉了结构记号
    expect(text).toContain('路由问题 [1] 很重要。')
  })

  it('非法 format 仍然优先报 400（两条校验不能互相吞掉）', async () => {
    const { GET } = await loadRoute()
    const res = await GET(get('?format=pdf&style=mla'), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Unsupported format')
  })

  it('稿件不存在 → 404', async () => {
    dbMock.get('manuscript').findUnique.mockResolvedValue(null)
    const { GET } = await loadRoute()
    const res = await GET(get('?style=gbt7714'), ctx)
    expect(res.status).toBe(404)
  })
})
