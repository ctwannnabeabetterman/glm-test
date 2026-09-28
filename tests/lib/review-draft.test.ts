import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

/**
 * 「阅读 → 综述草稿」的行为契约（真正调用路由 handler，不是 grep 源码）。
 *
 * 2026-09-20 重写 `/api/ai-review` 时立的几条线，任何一条断了都会让这个功能
 * 悄悄退化成「全库最新 15 篇 + 自由文本引用」—— 而且不会有任何报错：
 *
 *  1. 取料按**阅读范围**筛：默认只用作「已读」的文献（这是「阅读→综述」的地基）；
 *  2. 取料按**课题域**筛（复用 `scopeByTopic`，与 AI 研究分析同一套口径）；
 *  3. **没有原料必须拒绝**，不能拿空清单让模型凭记忆编综述；
 *  4. 正文里的 `[@id]` 必须与清单对齐，**清单外的 id 要当场报出来**；
 *  5. 提示词里必须写清引用语法（它是与写作工作台之间的接口约定）。
 */

const dbMock = vi.hoisted(() => {
  const make = () => ({
    findMany: vi.fn(async () => [] as unknown[]),
    findUnique: vi.fn(async () => null as unknown),
    findFirst: vi.fn(async () => null as unknown),
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
  const db = new Proxy({} as Record<string, Model>, {
    get: (_t, prop) => get(String(prop)),
  })
  return { db, get }
})

vi.mock('@/lib/db', () => ({ db: dbMock.db }))

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>()
  return { ...actual, chatComplete: vi.fn(), resolveLlmConfig: vi.fn() }
})

import { chatComplete } from '@/lib/llm'

function paper(over: Partial<Record<string, unknown>> & { id: string }) {
  return {
    title: `Title ${over.id}`,
    authors: 'Nasir, Y. S.',
    venue: 'IEEE JSAC',
    year: 2024,
    tags: '',
    category: 'method',
    status: 'read',
    relevance: 5,
    abstract: 'abstract text',
    topicIds: '[]',
    ...over,
  }
}

const READ_PAPER = paper({ id: 'p-read', status: 'read' })
const UNREAD_PAPER = paper({ id: 'p-unread', status: 'unread' })
const READING_PAPER = paper({ id: 'p-reading', status: 'reading' })

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/ai-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function loadRoute() {
  return import('@/app/api/ai-review/route')
}

beforeEach(() => {
  vi.mocked(chatComplete).mockReset()
  for (const name of ['paper', 'topic', 'note', 'setting']) {
    const m = dbMock.get(name)
    m.findMany.mockClear()
    m.findUnique.mockClear()
    m.findUnique.mockResolvedValue(null)
  }
  dbMock.get('paper').findMany.mockResolvedValue([READ_PAPER, UNREAD_PAPER, READING_PAPER])
})

describe('/api/ai-review：阅读范围决定取料', () => {
  it('默认（scope 缺省）只用「已读」—— 未读/在读不得进入综述依据', async () => {
    vi.mocked(chatComplete).mockResolvedValue('综述正文 [@p-read]')
    const { POST } = await loadRoute()
    const res = await POST(post({ topic: '语义通信' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.used.papers).toBe(1)
    // 被阅读范围挡在外面 2 篇（unread + reading）—— 必须如实回报，用户才知道漏了什么
    expect(body.used.excludedByScope).toBe(2)
    expect(body.used.scopeLabel).toBe('仅已读')

    const sent = vi.mocked(chatComplete).mock.calls[0][0]
    const userText = sent.map((m) => m.content).join('\n')
    expect(userText).toContain('p-read')
    expect(userText).not.toContain('p-unread')
    expect(userText).not.toContain('p-reading')
  })

  it('scope=reading 纳入「在读」；scope=all 不筛状态', async () => {
    vi.mocked(chatComplete).mockResolvedValue('x')
    const { POST } = await loadRoute()

    const res1 = await POST(post({ topic: 't', scope: 'reading' }))
    expect((await res1.json()).used.papers).toBe(2)

    const res2 = await POST(post({ topic: 't', scope: 'all' }))
    expect((await res2.json()).used.papers).toBe(3)
  })

  it('未知 scope / focus → 400 且不打 LLM（省一次调用，也避免误报为调用失败）', async () => {
    const { POST } = await loadRoute()
    const badScope = await POST(post({ topic: 't', scope: 'yesterday' }))
    expect(badScope.status).toBe(400)
    expect((await badScope.json()).error).toContain('Unsupported scope')

    const badFocus = await POST(post({ topic: 't', focus: 'vibes' }))
    expect(badFocus.status).toBe(400)
    expect((await badFocus.json()).error).toContain('Unsupported focus')

    expect(chatComplete).not.toHaveBeenCalled()
  })
})

describe('/api/ai-review：课题域与空料守卫', () => {
  it('按课题域筛：只把挂到该课题的论文喂给模型', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue({
      id: 'tp1',
      name: 'RIS 资源分配',
      direction: 'MAC层',
      description: '',
    })
    dbMock.get('paper').findMany.mockResolvedValue([
      paper({ id: 'p-in', topicIds: JSON.stringify(['tp1']) }),
      paper({ id: 'p-out', topicIds: JSON.stringify(['other']), title: 'Unrelated' }),
    ])
    vi.mocked(chatComplete).mockResolvedValue('综述 [@p-in]')
    const { POST } = await loadRoute()
    const res = await POST(post({ topic: 'RIS', topicId: 'tp1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.used.papers).toBe(1)
    expect(body.topicName).toBe('RIS 资源分配')

    const userText = vi.mocked(chatComplete).mock.calls[0][0].map((m) => m.content).join('\n')
    expect(userText).toContain('p-in')
    expect(userText).not.toContain('p-out')
  })

  it('显式选了不存在的课题 → 400（不静默降级成全库，否则用户以为拿到的是该课题的综述）', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue(null)
    const { POST } = await loadRoute()
    const res = await POST(post({ topic: 't', topicId: 'ghost-topic' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('课题不存在')
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('该范围内没有论文 → 400 + NO_CONTEXT，绝不放模型自由发挥', async () => {
    dbMock.get('paper').findMany.mockResolvedValue([UNREAD_PAPER])
    const { POST } = await loadRoute()
    const res = await POST(post({ topic: 't' })) // 默认仅已读 ⇒ 空料
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('NO_CONTEXT')
    expect(body.error).toContain('不限阅读状态') // 给出可操作的下一步
    expect(chatComplete).not.toHaveBeenCalled()
  })
})

describe('/api/ai-review：引用标记必须与清单对齐', () => {
  it('检出清单外的 [@id]（模型编造）并原样回报，不静默丢弃', async () => {
    vi.mocked(chatComplete).mockResolvedValue(
      '已有研究表明 [@p-read] 有效，但 [@ghost-2024] 提出了相反结论 [@Nasir, 2024]。',
    )
    const { POST } = await loadRoute()
    const res = await POST(post({ topic: 't' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.citations.known).toBe(1)
    expect(body.citations.unknown).toContain('ghost-2024')
    // 把作者名当 id 写进标记也是最常见的一种编造
    expect(body.citations.unknown.some((c: string) => c.includes('Nasir'))).toBe(true)
  })

  it('全部命中时 unknown 为空（不能把好结果也报成可疑）', async () => {
    vi.mocked(chatComplete).mockResolvedValue('结论一 [@p-read]，结论二 [@p-read, @p-reading]。')
    const { POST } = await loadRoute()
    const res = await POST(post({ topic: 't', scope: 'all' }))
    const body = await res.json()
    expect(body.citations.unknown).toEqual([])
    expect(body.citations.known).toBe(2)
  })
})

describe('综述提示词：引用语法是与写作工作台的接口约定', () => {
  it('路由里写明了 [@id] 语法、禁止自造编号与参考文献表', () => {
    const src = readFileSync(path.resolve('src/app/api/ai-review/route.ts'), 'utf8')
    expect(src).toMatch(/\[@论文id\]/)
    expect(src).toMatch(/禁止输出参考文献表/)
    expect(src).toMatch(/禁止自行编造 id/)
  })

  it('面板：取料口径可调、能把草稿发到写作台', () => {
    const src = readFileSync(path.resolve('src/components/ai-review-generator.tsx'), 'utf8')
    // 课题域 + 阅读范围必须都进请求体
    expect(src).toMatch(/topicId:/)
    expect(src).toMatch(/scope,/)
    expect(src).toMatch(/SelectTrigger/)
    // 一键投递（否则用户要手动复制到正确章节）
    expect(src).toMatch(/sendDraftToWriting/)
    expect(src).toMatch(/setSection\('writing'\)/)
    // 编造的引用必须当场提示
    expect(src).toMatch(/citations\.unknown/)
  })

  it('工作台侧：接收投递并插成新章节（两端缺一个，通道就是死的）', () => {
    const src = readFileSync(path.resolve('src/components/writing-workbench.tsx'), 'utf8')
    expect(src).toMatch(/takeDraftInbox/)
    expect(src).toMatch(/draftInbox/)
    expect(src).toMatch(/newSection\(job\.title/)
  })
})

/**
 * 材料的「来源可交代」—— 2026-09-28 新增（方向 A：可追溯的科研证据链，第一小步）。
 *
 * 原来的问题是界面与实现不一致：界面说「未归课题的不会算进来」，
 * 而取料实际会带上关键词命中的文献。用户无从判断哪些材料是自己确认过的、
 * 哪些只是「标题里恰好有那个词」—— 这正是「证据链」最底层的一环。
 */
describe('/api/ai-review：材料的来源必须可分辨', () => {
  it('手挂与「仅关键词命中」分开计数，并给出逐篇来源', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue({
      id: 'tp1', name: 'RIS 资源分配', direction: 'MAC层', description: '',
    })
    dbMock.get('paper').findMany.mockResolvedValue([
      paper({ id: 'p-linked', topicIds: JSON.stringify(['tp1']) }),
      // 标题里有 RIS ⇒ 关键词兜底命中，但用户从没把它挂到本课题上
      paper({ id: 'p-kw', title: 'RIS assisted allocation', topicIds: '[]' }),
      paper({ id: 'p-off', title: 'Unrelated', topicIds: '[]' }),
    ])
    vi.mocked(chatComplete).mockResolvedValue('综述 [@p-linked]')

    const { POST } = await loadRoute()
    const res = await POST(post({ topic: 'RIS', topicId: 'tp1' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.used.linkedPapers).toBe(1)
    expect(body.used.keywordPapers).toBe(1)
    expect(body.used.papers).toBe(2)

    // 逐篇来源：reason 是机器可读的原值（前端靠它筛出「未确认」的那些）
    const reasons = Object.fromEntries(
      (body.sources as Array<{ id: string; reason: string }>).map((s) => [s.id, s.reason]),
    )
    expect(reasons['p-linked']).toBe('linked')
    expect(reasons['p-kw']).toBe('keyword')
    // 完全无关的不许出现在来源清单里（否则用户会以为它参与了）
    expect(reasons['p-off']).toBeUndefined()
  })

  it('提示词里也交代了证据强度分布（模型不该把未确认材料当已知事实）', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue({
      id: 'tp1', name: 'RIS 资源分配', direction: 'MAC层', description: '',
    })
    dbMock.get('paper').findMany.mockResolvedValue([
      paper({ id: 'p-linked', topicIds: JSON.stringify(['tp1']) }),
      paper({ id: 'p-kw', title: 'RIS assisted allocation', topicIds: '[]' }),
    ])
    vi.mocked(chatComplete).mockResolvedValue('x')
    const { POST } = await loadRoute()
    await POST(post({ topic: 'RIS', topicId: 'tp1' }))

    const userText = vi.mocked(chatComplete).mock.calls[0][0].map((m) => m.content).join('\n')
    expect(userText).toContain('手挂到本课题 1 篇')
    expect(userText).toContain('仅关键词命中 1 篇')
  })

  it('超出上限被截断的部分计入 truncated，且不出现在来源清单里（不静默丢掉）', async () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      paper({ id: `p${i}`, topicIds: JSON.stringify(['tp1']) }),
    )
    dbMock.get('topic').findUnique.mockResolvedValue({
      id: 'tp1', name: 'RIS', direction: '', description: '',
    })
    dbMock.get('paper').findMany.mockResolvedValue(many)
    vi.mocked(chatComplete).mockResolvedValue('x')

    const { POST } = await loadRoute()
    const res = await POST(post({ topic: 'RIS', topicId: 'tp1' }))
    const body = await res.json()

    expect(body.used.papers).toBe(40)
    expect(body.used.truncated).toBe(5)
    expect(body.sources).toHaveLength(40)
  })

  it('不限定课题时不得把条目说成「手挂到本课题」', async () => {
    dbMock.get('paper').findMany.mockResolvedValue([paper({ id: 'p1' })])
    vi.mocked(chatComplete).mockResolvedValue('x')
    const { POST } = await loadRoute()
    const res = await POST(post({ topic: 't' })) // 不传 topicId
    const body = await res.json()
    expect(body.used.linkedPapers).toBe(0)
    expect(body.used.keywordPapers).toBe(0)
    expect((body.sources as Array<{ reason: string }>)[0].reason).toBe('all')
  })
})

describe('综述面板：不得再声称「未归课题的不会算进来」', () => {
  const src = readFileSync(path.resolve('src/components/ai-review-generator.tsx'), 'utf8')

  it('旧文案已删除（它与关键词兜底自相矛盾，是在对用户说谎）', () => {
    // ⚠️ 这句旧文案**连注释里都不许出现**：出现即视为又把承诺写回去了。
    // 需要解释来历时请换一种说法（组件里已如此处理）。
    expect(src).not.toMatch(/未归课题的不会算进来/)
  })

  it('改为如实说明两级来源，并把未确认的部分单独标出', () => {
    expect(src).toMatch(/仅关键词命中/)
    expect(src).toMatch(/未经确认/)
    expect(src).toMatch(/unconfirmedSources/)
  })
})
