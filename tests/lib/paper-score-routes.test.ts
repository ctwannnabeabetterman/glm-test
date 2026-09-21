import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

/**
 * 「AI 给论文打分 → 用户确认 → 写回库 → 记来源标记」这条链的行为契约。
 *
 * 为什么必须真调 handler：这条链上有三类**不会报错**的错误 ——
 *  ① 模型返回清单之外的 id（编造），被静默采纳 → 库里出现一个不存在的论文分数；
 *  ② 越界数值（relevance=99）/ 非法优先级（"urgent"）直接写进库 → 那张榜从此不可信；
 *  ③ 写回之后没摘掉旧标记，或没记上新标记 → 界面上的「AI 徽标」开始说谎。
 * 编译期、类型检查、单测都抓不到这三类，只有把请求打进去断言**写入参数**才行。
 */

const dbMock = vi.hoisted(() => {
  const make = () => ({
    findMany: vi.fn(async () => [] as unknown[]),
    findUnique: vi.fn(async () => null as unknown),
    findFirst: vi.fn(async () => null as unknown),
    count: vi.fn(async () => 0),
    create: vi.fn(),
    update: vi.fn(),
    // ⚠️ 参数类型必须显式写出来：`vi.fn(async () => ...)` 的调用签名是「零参数」，
    // 于是 `mock.calls[0][0]` 会被推断成 never / 元组越界 —— 本项目踩过一次，别再省这两行。
    updateMany: vi.fn(async (_args: { where: { id: string }; data?: unknown }) => ({ count: 0 })),
    upsert: vi.fn(async (_args: Record<string, unknown>) => ({})),
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

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>()
  return { ...actual, chatComplete: vi.fn(), resolveLlmConfig: vi.fn() }
})

import { LlmNotConfiguredError, chatComplete } from '@/lib/llm'

function paperRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    title: 'Deep RL for Routing',
    authors: 'Nasir, Y. S., Guo, D.',
    venue: 'IEEE JSAC',
    year: 2024,
    tags: 'DRL',
    category: 'method',
    status: 'unread',
    relevance: 5,
    novelty: 5,
    priority: 'medium',
    codeUrl: '',
    abstract: 'This paper studies routing.',
    topicIds: '[]',
    ...over,
  }
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.mocked(chatComplete).mockReset()
  for (const name of ['paper', 'topic', 'setting']) {
    const m = dbMock.get(name)
    m.findMany.mockClear()
    m.findMany.mockResolvedValue([])
    m.findUnique.mockClear()
    m.findUnique.mockResolvedValue(null)
    m.updateMany.mockClear()
    m.updateMany.mockResolvedValue({ count: 0 })
    m.upsert.mockClear()
  }
  dbMock.get('paper').findMany.mockResolvedValue([paperRow()])
})

describe('/api/ai-paper-score：取料与失败契约', () => {
  it('范围内没有论文 → 400 + NO_CONTEXT，且不打 LLM', async () => {
    dbMock.get('paper').findMany.mockResolvedValue([])
    const { POST } = await import('@/app/api/ai-paper-score/route')
    const res = await POST(post({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('NO_CONTEXT')
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('scope=unread 时已读论文不参与（否则等于「重评对象」和界面口径不一致）', async () => {
    dbMock.get('paper').findMany.mockResolvedValue([
      paperRow({ id: 'p-unread', status: 'unread' }),
      paperRow({ id: 'p-read', status: 'read' }),
    ])
    vi.mocked(chatComplete).mockResolvedValue('{"scores":[]}')
    const { POST } = await import('@/app/api/ai-paper-score/route')
    const res = await POST(post({ scope: 'unread' }))
    expect(res.status).toBe(200)
    const userText = vi.mocked(chatComplete).mock.calls[0][0].map((m) => m.content).join('\n')
    expect(userText).toContain('p-unread')
    expect(userText).not.toContain('p-read')
  })

  it('未知 scope → 400 且不打 LLM', async () => {
    const { POST } = await import('@/app/api/ai-paper-score/route')
    const res = await POST(post({ scope: 'yesterday' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Unsupported scope')
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('指定了不存在的课题 → 400（相关度是相对课题的量，换参照系就不可比）', async () => {
    const { POST } = await import('@/app/api/ai-paper-score/route')
    const res = await POST(post({ topicId: 'ghost' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('课题不存在')
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('未配置 Key → 400 + LLM_NOT_CONFIGURED；上游失败 → 502 + LLM_CALL_FAILED', async () => {
    const { POST } = await import('@/app/api/ai-paper-score/route')

    vi.mocked(chatComplete).mockRejectedValue(new LlmNotConfiguredError())
    const a = await POST(post({}))
    expect(a.status).toBe(400)
    expect((await a.json()).code).toBe('LLM_NOT_CONFIGURED')

    vi.mocked(chatComplete).mockRejectedValue(new Error('上游炸了'))
    const b = await POST(post({}))
    expect(b.status).toBe(502)
    expect((await b.json()).code).toBe('LLM_CALL_FAILED')
  })

  it('提示词把 id 清单与「只输出 JSON」的约束都带上（后者与 Markdown 格式合同互斥）', async () => {
    vi.mocked(chatComplete).mockResolvedValue('{"scores":[]}')
    const { POST } = await import('@/app/api/ai-paper-score/route')
    await POST(post({}))
    const msgs = vi.mocked(chatComplete).mock.calls[0][0]
    const system = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    const user = msgs.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    expect(user).toContain('p1')
    expect(user).toContain('"id"')
    expect(system).toContain('只输出一个 JSON 对象')
    // ⚠️ 不能同时拼 Markdown 格式合同（会让模型在两种格式间摇摆）
    expect(system).not.toContain('用 Markdown 组织内容')
  })
})

describe('/api/ai-paper-score：清单外的 id 必须回报而不能采纳', () => {
  it('模型编的 id 不进 suggestions，但出现在 unknownIds 里', async () => {
    vi.mocked(chatComplete).mockResolvedValue(
      '{"scores":[{"id":"p1","relevance":9,"novelty":8,"priority":"high","reason":"与课题相关"},{"id":"ghost-1","relevance":10}]}',
    )
    const { POST } = await import('@/app/api/ai-paper-score/route')
    const res = await POST(post({}))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions).toHaveLength(1)
    expect(body.suggestions[0]).toMatchObject({ id: 'p1', relevance: 9, novelty: 8, priority: 'high' })
    expect(body.unknownIds).toEqual(['ghost-1'])
  })

  it('越界数值与非法优先级在解析层就被收敛，不会漏到接口外层', async () => {
    vi.mocked(chatComplete).mockResolvedValue('{"scores":[{"id":"p1","relevance":99,"novelty":-5,"priority":"非常高"}]}')
    const { POST } = await import('@/app/api/ai-paper-score/route')
    const body = await (await POST(post({}))).json()
    expect(body.suggestions[0]).toMatchObject({ relevance: 10, novelty: 1, priority: 'medium' })
  })
})

describe('/api/papers/apply-scores：写入参数必须是收敛过的', () => {
  it('空 items → 400，不碰数据库', async () => {
    const { POST } = await import('@/app/api/papers/apply-scores/route')
    const res = await POST(post({ items: [] }))
    expect(res.status).toBe(400)
    expect(dbMock.get('paper').updateMany).not.toHaveBeenCalled()
  })

  it('越界数值/非法优先级在入口被夹紧后才写库', async () => {
    dbMock.get('paper').updateMany.mockResolvedValue({ count: 1 })
    const { POST } = await import('@/app/api/papers/apply-scores/route')
    const res = await POST(
      post({ items: [{ id: 'p1', relevance: 99, novelty: -3, priority: 'urgent' }] }),
    )
    expect(res.status).toBe(200)
    expect(dbMock.get('paper').updateMany).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { relevance: 10, novelty: 1, priority: 'medium' },
    })
  })

  it('论文已被删除时只报 missing，不把整批带崩', async () => {
    // 按调用顺序返回：第一条成功、第二条 count=0（模拟那篇已被删）
    dbMock.get('paper').updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const { POST } = await import('@/app/api/papers/apply-scores/route')
    const body = await (
      await POST(post({ items: [{ id: 'p1', relevance: 8, novelty: 8, priority: 'high' }, { id: 'gone' }] }))
    ).json()
    expect(body.applied).toBe(1)
    expect(body.missing).toEqual(['gone'])
  })

  it('写回成功后写入「分数来自 AI」的来源标记（否则界面徽标会说谎）', async () => {
    dbMock.get('paper').updateMany.mockResolvedValue({ count: 1 })
    const { POST } = await import('@/app/api/papers/apply-scores/route')
    await POST(post({ items: [{ id: 'p1', relevance: 9, novelty: 7, priority: 'high' }] }))

    const upsert = dbMock.get('setting').upsert
    expect(upsert).toHaveBeenCalled()
    const args = upsert.mock.calls[0][0] as { where: { key: string }; create: { value: string } }
    expect(args.where.key).toBe('papers.ai-scored')
    const saved = JSON.parse(args.create.value)
    expect(Object.keys(saved)).toEqual(['p1'])
    expect(typeof saved.p1.at).toBe('string')
  })

  it('全部失败时不写标记（没有应用的条目就没有「AI 给的分」）', async () => {
    dbMock.get('paper').updateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import('@/app/api/papers/apply-scores/route')
    const body = await (await POST(post({ items: [{ id: 'gone' }] }))).json()
    expect(body.applied).toBe(0)
    expect(dbMock.get('setting').upsert).not.toHaveBeenCalled()
  })
})

describe('/api/papers/score-provenance：把来源标记交给前端', () => {
  it('从设置行读出映射；坏数据降级成空对象而不是 500', async () => {
    const { GET } = await import('@/app/api/papers/score-provenance/route')

    dbMock.get('setting').findUnique.mockResolvedValue({
      key: 'papers.ai-scored',
      value: '{"p1":{"at":"2026-09-21T00:00:00.000Z"}}',
    })
    const ok = await (await GET()).json()
    expect(ok.scored).toEqual({ p1: { at: '2026-09-21T00:00:00.000Z' } })

    dbMock.get('setting').findUnique.mockResolvedValue({ key: 'papers.ai-scored', value: '{坏 JSON' })
    const bad = await (await GET()).json()
    expect(bad.scored).toEqual({})
  })
})

describe('手工改分数必须摘掉 AI 标记', () => {
  it('PUT /api/papers/[id] 收到 relevance/novelty/priority 时清标记', () => {
    const src = readFileSync(path.resolve('src/app/api/papers/[id]/route.ts'), 'utf8')
    expect(src).toMatch(/clearScoredInDb/)
    expect(src).toMatch(/'relevance', 'novelty', 'priority'/)
  })

  it('清标记只在真的有变化时才写库（手工编辑是高频操作）', () => {
    const src = readFileSync(path.resolve('src/lib/library/score-provenance-server.ts'), 'utf8')
    expect(src).toMatch(/Object\.keys\(next\)\.length !== Object\.keys\(current\)\.length/)
  })
})
