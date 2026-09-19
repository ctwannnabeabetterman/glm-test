import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { ALL_SUB_ITEMS } from '@/lib/methodology/topic-ai'

/**
 * 课题相关 AI 路由的契约（**真正调用 handler**）。
 *
 * 对应 2026-09-18 用户反馈的两条：
 *  1. 「打分应该是 AI 打的吧」→ `/api/ai-topic-score`
 *  2. 「AI 研究分析应该要加一个课题选择 … 容易在课题多了以后互相干扰」
 *     → `/api/ai-gap-analysis` 必须按课题域筛，且**拿不到材料时要如实拒绝**
 *
 * 第 2 点的最后半句是这里最重要的断言：旧实现无论有没有材料都会调模型，
 * 于是模型只能凭记忆编 research gap —— 这正是「没有原料的幻觉」。
 * 现在必须返回 400 + NO_CONTEXT，且**不得**调到 LLM。
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
    get: (_target, prop) => get(String(prop)),
  })
  return { db, get }
})

vi.mock('@/lib/db', () => ({ db: dbMock.db }))

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>()
  return { ...actual, chatComplete: vi.fn(), resolveLlmConfig: vi.fn() }
})

import { LlmNotConfiguredError, chatComplete } from '@/lib/llm'

const TOPIC = {
  id: 't1',
  name: '基于DRL的RIS辅助无线资源分配',
  direction: '物理层',
  description: '面向 6G 的资源分配',
  totalScore: 7,
}

const PAPER = {
  id: 'p1',
  title: 'DRL for RIS resource allocation',
  authors: 'Zhang',
  venue: 'ICC',
  year: 2024,
  tags: 'rl',
  category: 'method',
  status: 'read',
  relevance: 8,
  abstract: '摘要正文',
  topicIds: '["t1"]',
}

const NOTE = {
  id: 'n1',
  title: '关于 RIS 的思考',
  tags: 'ris',
  content: '正文',
  topicIds: '["t1"]',
  updatedAt: new Date(),
}

function post(body: Record<string, unknown>, url = 'http://localhost/api/test'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * 剥掉 `//` 行注释与 `/* *​/` 块注释（静态守卫专用）。
 *
 * 为什么需要它：本文件有一批「路由里不许再出现 X」的守卫，而那些路由的注释
 * **故意**引用了旧的错误写法来解释改动原因。裸 `expect(src).not.toMatch(/X/)`
 * 会把这段解释也扫进去，于是「说明自己修了什么」反而让守卫失败 ——
 * 这类假失败最浪费排查时间。先剥注释再匹配，守卫才真正盯住代码。
 *
 * 简化实现（够用就好，不要用来做通用 JS 解析）：
 *  - 用带单引号/双引号/反引号保护的状态机逐字符走，避免把字符串里的 `//` 当注释；
 *  - 不处理正则字面量中的 `//`（本仓库路由里没有这种情况）。
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    out += ch
    i += 1
  }
  return out
}

beforeEach(() => {
  vi.mocked(chatComplete).mockReset()
  for (const name of ['paper', 'topic', 'note']) {
    const m = dbMock.get(name)
    m.findMany.mockReset()
    m.findUnique.mockReset()
    m.findMany.mockResolvedValue([])
    m.findUnique.mockResolvedValue(null)
  }
})

describe('/api/ai-topic-score：AI 打分', () => {
  const load = () => import('@/app/api/ai-topic-score/route')

  it('未配置 Key → 400 + LLM_NOT_CONFIGURED（而不是裸 500）', async () => {
    vi.mocked(chatComplete).mockRejectedValue(new LlmNotConfiguredError())
    const { POST } = await load()
    const res = await POST(post({ topicId: 't1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('LLM_NOT_CONFIGURED')
  })

  it('上游失败 → 502 + LLM_CALL_FAILED', async () => {
    vi.mocked(chatComplete).mockRejectedValue(new Error('上游炸了'))
    const { POST } = await load()
    const res = await POST(post({ topicId: 't1' }))
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('LLM_CALL_FAILED')
  })

  it('既没有 topicId 也没有 name → 400，且不调 LLM', async () => {
    const { POST } = await load()
    const res = await POST(post({}))
    expect(res.status).toBe(400)
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('模型吐了内容但不是 JSON → 502 + LLM_BAD_OUTPUT，绝不把全 5 分当 AI 结果写回', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue(TOPIC)
    vi.mocked(chatComplete).mockResolvedValue('我觉得这个课题还不错，大概 7 分吧。')
    const { POST } = await load()
    const res = await POST(post({ topicId: 't1' }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('LLM_BAD_OUTPUT')
    // 关键：不能有 scores 字段，否则前端会拿它落库
    expect(body.scores).toBeUndefined()
  })

  it('JSON 里一项都没识别出来 → 照样 502（不能冒充成功）', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue(TOPIC)
    vi.mocked(chatComplete).mockResolvedValue('{"scores": {"无关键": 5}}')
    const { POST } = await load()
    const res = await POST(post({ topicId: 't1' }))
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('LLM_BAD_OUTPUT')
  })

  it('正常路径 → 200 + 完整分数表 + 依据统计', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue(TOPIC)
    dbMock.get('paper').findMany.mockResolvedValue([PAPER])
    dbMock.get('note').findMany.mockResolvedValue([NOTE])
    vi.mocked(chatComplete).mockResolvedValue(
      JSON.stringify({ scores: { 问题新颖度: 8, 方法创新性: 7 }, rationale: '理由' })
    )
    const { POST } = await load()
    const res = await POST(post({ topicId: 't1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.scored).toBe(2)
    // 个数从矩阵推导，不硬编（曾经按「14 项」写死，实际是 13）
    expect(body.missing.length).toBe(ALL_SUB_ITEMS.length - 2)
    expect(body.scores['创新性']['问题新颖度']).toBe(8)
    // 前端要用它显示「本次依据 N 篇论文」，以及「还有 M 篇没挂这个课题」
    expect(body.evidence.paperCount).toBe(1)
    expect(body.evidence.noteCount).toBe(1)
    expect(typeof body.evidence.unlinkedPapers).toBe('number')
  })

  it('只给 name（课题还没存库）也能试算', async () => {
    vi.mocked(chatComplete).mockResolvedValue('{"scores":{"问题新颖度":6}}')
    const { POST } = await load()
    const res = await POST(post({ name: '一个还没保存的课题' }))
    expect(res.status).toBe(200)
  })

  it('提示词里必须带防编造约束（打分要按课题事实，不是凭印象）', () => {
    const src = stripComments(readFileSync(path.resolve('src/app/api/ai-topic-score/route.ts'), 'utf8'))
    expect(src).toMatch(/NO_FABRICATION_GUARD/)
  })

  it('提示词里带评分矩阵口径，且**不**调用 Markdown 格式合同（与 JSON 输出互斥）', () => {
    // 断言不能写成 `/OUTPUT_FORMAT_CONTRACT/` —— 本文件的路由注释里正好提到了
    // 这个名字（解释「为什么不拼它」），裸匹配会把注释也算作命中，
    // 于是「解释自己没做某件事」反而让守卫失败。剥掉注释后再钉。
    const src = stripComments(readFileSync(path.resolve('src/app/api/ai-topic-score/route.ts'), 'utf8'))
    expect(src).toMatch(/AI_SCORE_RUBRIC/)
    expect(src).toMatch(/AI_SCORE_JSON_CONTRACT/)
    expect(src).not.toMatch(/OUTPUT_FORMAT_CONTRACT/)
  })
})

describe('/api/ai-gap-analysis：课题域', () => {
  const load = () => import('@/app/api/ai-gap-analysis/route')

  it('非法 type → 400，不调 LLM', async () => {
    const { POST } = await load()
    const res = await POST(post({ type: 'nope' }))
    expect(res.status).toBe(400)
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('指定了不存在的课题 → 400（不允许静默降级成全库分析）', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue(null)
    const { POST } = await load()
    const res = await POST(post({ type: 'gaps', topicId: 'ghost' }))
    expect(res.status).toBe(400)
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('课题下无任何论文与笔记 → 400 + NO_CONTEXT，**不得**调 LLM 硬编', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue(TOPIC)
    dbMock.get('paper').findMany.mockResolvedValue([])
    dbMock.get('note').findMany.mockResolvedValue([])
    const { POST } = await load()
    const res = await POST(post({ type: 'gaps', topicId: 't1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('NO_CONTEXT')
    expect(body.error).toContain(TOPIC.name)
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('全库模式且完全没数据 → 同样拒绝', async () => {
    dbMock.get('topic').findMany.mockResolvedValue([])
    dbMock.get('paper').findMany.mockResolvedValue([])
    dbMock.get('note').findMany.mockResolvedValue([])
    const { POST } = await load()
    const res = await POST(post({ type: 'gaps' }))
    expect(res.status).toBe(400)
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('指定课题时只把本课题相关的论文喂给模型，无关论文不得进入提示词', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue(TOPIC)
    dbMock.get('paper').findMany.mockResolvedValue([
      PAPER,
      { ...PAPER, id: 'p2', title: '量子纠缠实验报告', tags: '', abstract: '', topicIds: '[]' },
    ])
    dbMock.get('note').findMany.mockResolvedValue([NOTE])
    vi.mocked(chatComplete).mockResolvedValue('分析结果')
    const { POST } = await load()
    const res = await POST(post({ type: 'gaps', topicId: 't1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.topicName).toBe(TOPIC.name)
    expect(body.used.papers).toBe(1)

    const prompt = vi.mocked(chatComplete).mock.calls[0][0]
    const full = prompt.map((m) => m.content).join('\n')
    expect(full).toContain('DRL for RIS resource allocation')
    expect(full).not.toContain('量子纠缠实验报告')
    // 提示词必须点明本次范围，否则模型会按「全领域」去答
    expect(full).toContain('仅限课题')
  })

  it('回传 used 统计，前端才能显示「依据 N 篇 / M 条」', async () => {
    dbMock.get('topic').findUnique.mockResolvedValue(TOPIC)
    dbMock.get('paper').findMany.mockResolvedValue([PAPER])
    dbMock.get('note').findMany.mockResolvedValue([NOTE])
    vi.mocked(chatComplete).mockResolvedValue('结果')
    const { POST } = await load()
    const res = await POST(post({ type: 'literature', topicId: 't1' }))
    const body = await res.json()
    expect(body.used).toMatchObject({ papers: 1, notes: 1 })
    expect(typeof body.used.unlinkedPapers).toBe('number')
  })

  it('不再用「按年份取 20 篇」这种与课题无关的取法', () => {
    // 静态守卫必须先剥掉注释再扫。本文件的路由注释里**故意**写了
    // 「旧实现是 `paper.findMany({ take: 20, ... })`」来解释改动原因，
    // 裸匹配会把这段解释当成违规代码，于是「说明自己修了什么」反而让守卫失败。
    const src = stripComments(readFileSync(path.resolve('src/app/api/ai-gap-analysis/route.ts'), 'utf8'))
    expect(src).not.toMatch(/take:\s*20\b/)
    expect(src).not.toMatch(/take:\s*10\b/)
    // 必须走课题域筛选
    expect(src).toMatch(/scopeByTopic/)
    // 且必须回传本次实际用到的原料量
    expect(src).toMatch(/used:/)
  })

  it('提示词仍带防编造约束与格式合同（不能在这次改动里丢掉）', () => {
    const src = stripComments(readFileSync(path.resolve('src/app/api/ai-gap-analysis/route.ts'), 'utf8'))
    expect(src).toMatch(/NO_FABRICATION_GUARD/)
    expect(src).toMatch(/OUTPUT_FORMAT_CONTRACT/)
  })
})

describe('/api/topics?withCounts=1：让用户看到课题有多少料', () => {
  it('返回每个课题的论文数与笔记数，且用的是同一套筛选逻辑', async () => {
    dbMock.get('topic').findMany.mockResolvedValue([TOPIC])
    dbMock.get('paper').findMany.mockResolvedValue([PAPER])
    dbMock.get('note').findMany.mockResolvedValue([NOTE])
    const { GET } = await import('@/app/api/topics/route')
    const res = await GET(
      new NextRequest('http://localhost/api/topics?withCounts=1')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0].paperCount).toBe(1)
    expect(body[0].noteCount).toBe(1)
  })

  it('不带参数时保持原样（只是列表，不额外查两张大表）', async () => {
    dbMock.get('topic').findMany.mockResolvedValue([TOPIC])
    dbMock.get('paper').findMany.mockClear()
    const { GET } = await import('@/app/api/topics/route')
    const res = await GET(new NextRequest('http://localhost/api/topics'))
    const body = await res.json()
    expect(body[0].paperCount).toBeUndefined()
    expect(dbMock.get('paper').findMany).not.toHaveBeenCalled()
  })
})
