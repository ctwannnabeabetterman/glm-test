import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

/**
 * AI 路由的失败契约测试（**真正调用路由 handler**，不是读源码 grep）。
 *
 * 为什么要有这个文件：2026-09-18 全量排查时发现，9 个调用 chatComplete 的路由里
 * 有 7 个把「没配 API Key」当普通异常吞掉、回裸 500。这类 bug 在任何编译器、
 * 类型检查、既有测试里**都不会报错** —— 只有把请求真打进去、断言状态码与
 * `code` 才能发现。所以这里逐个路由跑四条路径：
 *
 *   1. 未配置 Key   → 400 + code=LLM_NOT_CONFIGURED（不是 500，前端据此弹「去设置」）
 *   2. 上游调用失败 → 502 + code=LLM_CALL_FAILED
 *   3. 入参非法     → 400，且**不得**把请求打到 LLM（省一次调用、也避免误报为网络错误）
 *   4. 正常返回     → 200 + success:true（保证包 try/catch 时没把成功路径也改坏）
 *
 * 依赖全部 mock：`@/lib/db` 用 Proxy 自动兜住任意 model，
 * `@/lib/llm` 保留真实实现（`LlmNotConfiguredError` 必须是真类，instanceof 才成立）
 * 只把 `chatComplete` / `resolveLlmConfig` 换成 stub。
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

const PAPER = {
  id: 'p1',
  title: 'Deep RL for Routing',
  authors: 'Zhang',
  venue: 'ICC',
  year: 2024,
  tags: 'rl',
  notes: '',
  category: 'AI',
  status: 'read',
  relevance: 1,
}

vi.mock('@/lib/db', () => ({ db: dbMock.db }))

vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>()
  return { ...actual, chatComplete: vi.fn(), resolveLlmConfig: vi.fn() }
})

import { LlmNotConfiguredError, chatComplete, resolveLlmConfig } from '@/lib/llm'

interface RouteCase {
  name: string
  load: () => Promise<{ POST: (req: NextRequest) => Promise<Response> }>
  /** 能让路由走到 LLM 调用那一步的合法入参 */
  good: Record<string, unknown>
  /** 注定被入参校验挡下的请求体 */
  bad: Record<string, unknown>
}

const ROUTES: RouteCase[] = [
  {
    name: '/api/ai-summary',
    load: () => import('@/app/api/ai-summary/route'),
    good: { paperId: 'p1', type: 'summary' },
    bad: { type: 'summary' }, // 缺 paperId
  },
  {
    name: '/api/ai-abstract',
    load: () => import('@/app/api/ai-abstract/route'),
    good: { title: 'A Paper' },
    bad: {},
  },
  {
    name: '/api/ai-direction',
    load: () => import('@/app/api/ai-direction/route'),
    good: { candidate: '语义通信' },
    bad: { candidate: '   ' }, // 空白等价于没填
  },
  {
    name: '/api/ai-experiment',
    load: () => import('@/app/api/ai-experiment/route'),
    good: { topic: '路由优化', type: 'design' },
    bad: {},
  },
  {
    name: '/api/ai-gap-analysis',
    load: () => import('@/app/api/ai-gap-analysis/route'),
    // 注意：这条路由现在要求「有材料」才调 LLM（无材料返回 400 NO_CONTEXT），
    // 所以 good 用例必须靠 beforeEach 里喂进一篇论文来满足前置条件。
    good: { type: 'gaps' },
    bad: { type: 'nope' }, // 未支持的 type
  },
  {
    name: '/api/ai-related-papers',
    load: () => import('@/app/api/ai-related-papers/route'),
    good: { topic: '语义通信', type: 'directions' },
    bad: {},
  },
  {
    name: '/api/ai-review',
    load: () => import('@/app/api/ai-review/route'),
    good: { topic: '语义通信' },
    bad: {},
  },
  {
    name: '/api/planner/assist',
    load: () => import('@/app/api/planner/assist/route'),
    good: { mode: 'risk' },
    bad: { mode: 'nope' },
  },
]

function req(method: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function post(body: Record<string, unknown>): NextRequest {
  return req('POST', body)
}

beforeEach(() => {
  vi.mocked(chatComplete).mockReset()
  vi.mocked(resolveLlmConfig).mockReset()
  for (const name of ['paper', 'topic', 'note', 'experiment', 'milestone', 'weeklyTask', 'setting', 'manuscript']) {
    const m = dbMock.get(name)
    m.findMany.mockClear()
    m.findUnique.mockClear()
    m.upsert.mockClear()
    m.findUnique.mockResolvedValue(null)
  }
  // 让需要「论文存在」的路由（ai-summary）能走到 LLM 调用那一步
  dbMock.get('paper').findUnique.mockResolvedValue(PAPER)
  // ai-gap-analysis 现在要求「本范围内有材料」才调 LLM（2026-09-18 加了课题域后），
  // 所以这里默认喂一篇论文，好让它的四条失败契约能走到模型那一步。
  // 无材料时必须 400 NO_CONTEXT —— 那条由 topic-routes-contract.test.ts 单独钉住。
  dbMock.get('paper').findMany.mockResolvedValue([PAPER])
  dbMock.get('topic').findMany.mockResolvedValue([])
  dbMock.get('note').findMany.mockResolvedValue([])
})

describe.each(ROUTES)('$name：AI 失败契约', ({ load, good, bad }) => {
  it('未配置 API Key → 400 + LLM_NOT_CONFIGURED（而不是裸 500）', async () => {
    vi.mocked(chatComplete).mockRejectedValue(new LlmNotConfiguredError())
    const { POST } = await load()
    const res = await POST(post(good))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('LLM_NOT_CONFIGURED')
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('上游调用失败 → 502 + LLM_CALL_FAILED，并保留原文以便排查', async () => {
    vi.mocked(chatComplete).mockRejectedValue(new Error('上游炸了'))
    const { POST } = await load()
    const res = await POST(post(good))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('LLM_CALL_FAILED')
    expect(body.error).toContain('上游炸了')
  })

  it('入参非法 → 400，且不把请求打到 LLM', async () => {
    const { POST } = await load()
    const res = await POST(post(bad))
    expect(res.status).toBe(400)
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('正常返回 → 200 + success，包 try/catch 没改坏成功路径', async () => {
    vi.mocked(chatComplete).mockResolvedValue('模型回复')
    const { POST } = await load()
    const res = await POST(post(good))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.content).toBe('模型回复')
  })
})

describe('/api/settings/llm/test：连通性测试的契约', () => {
  const load = () => import('@/app/api/settings/llm/test/route')

  it('未配置 Key → 400 + LLM_NOT_CONFIGURED + ok:false（不发请求）', async () => {
    vi.mocked(resolveLlmConfig).mockResolvedValue({
      baseUrl: 'https://example/v1',
      model: 'm',
      hasKey: false,
      source: 'default',
    })
    const { POST } = await load()
    const res = await POST()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.code).toBe('LLM_NOT_CONFIGURED')
    expect(chatComplete).not.toHaveBeenCalled()
  })

  it('上游失败 → 502 + LLM_CALL_FAILED，并保留 ok:false 与 source', async () => {
    vi.mocked(resolveLlmConfig).mockResolvedValue({
      baseUrl: 'https://example/v1',
      model: 'm',
      hasKey: true,
      source: 'database',
    })
    vi.mocked(chatComplete).mockRejectedValue(new Error('401 令牌无效'))
    const { POST } = await load()
    const res = await POST()
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.code).toBe('LLM_CALL_FAILED')
    expect(body.source).toBe('database')
    expect(body.error).toContain('401 令牌无效')
  })

  it('连通成功 → 200 + ok:true', async () => {
    vi.mocked(resolveLlmConfig).mockResolvedValue({
      baseUrl: 'https://example/v1',
      model: 'glm-4-flash',
      hasKey: true,
      source: 'database',
    })
    vi.mocked(chatComplete).mockResolvedValue('连通')
    const { POST } = await load()
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.model).toBe('glm-4-flash')
  })
})

describe('/api/settings/llm：Base URL 的保存校验', () => {
  const load = () => import('@/app/api/settings/llm/route')

  // 「少写 https://」是最容易犯也最难自查的一种：存进去之后每个 AI 功能都会以
  // 一句 `Failed to parse URL` 失败，而那时已经跟「配置写错了」联系不上了。
  it.each(['open.bigmodel.cn/api/paas/v4', 'www.example.com/v1', 'ftp://example.com/v1', 'https://'])(
    '非法 Base URL「%s」→ 400，且不落库',
    async (bad) => {
      const { PUT } = await load()
      const res = await PUT(req('PUT', { baseUrl: bad }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('http')
      expect(dbMock.get('setting').upsert).not.toHaveBeenCalled()
    }
  )

  it.each(['https://open.bigmodel.cn/api/paas/v4', 'http://localhost:11434/v1'])(
    '合法 Base URL「%s」→ 200 且写入配置',
    async (ok) => {
      vi.mocked(resolveLlmConfig).mockResolvedValue({
        baseUrl: ok,
        model: 'glm-4-flash',
        hasKey: true,
        source: 'database',
      })
      const { PUT } = await load()
      const res = await PUT(req('PUT', { baseUrl: ok, model: 'glm-4-flash' }))
      expect(res.status).toBe(200)
      expect(dbMock.get('setting').upsert).toHaveBeenCalled()
    }
  )

  it('Base URL 留空表示「不覆盖」，不应被判为非法（回落 env/默认）', async () => {
    vi.mocked(resolveLlmConfig).mockResolvedValue({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      hasKey: false,
      source: 'default',
    })
    const { PUT } = await load()
    const res = await PUT(req('PUT', { baseUrl: '   ' }))
    expect(res.status).toBe(200)
  })
})

/**
 * 约定守卫：提示词里的「防编造」约束。
 *
 * 这类东西没有任何编译期或行为期保障 —— 删掉一句约束，代码照样跑、测试照样绿，
 * 只是模型开始编参考文献了。而编造的文献在科研工具里是最贵的一种错：
 * 它看起来完全合理，用户会拿着去检索、去引用。
 *
 * 这里按路由钉住「必须带哪个约束」，改动 prompt 时会在这里被拦一下，
 * 迫使改动者至少意识到自己在动这条线。
 */
describe('AI 提示词：防编造约束必须在位', () => {
  const GUARDED: Array<[routePath: string, pattern: RegExp, why: string]> = [
    // ai-summary 的约束是**条件**的：有摘要用 NO_FABRICATION_GUARD，没摘要才用
    // METADATA_ONLY_GUARD。所以这里两个都必须出现，且必须由 hasAbstract 分派 ——
    // 具体行为由下面的「ai-summary 按原料选口径」用例钉住。
    ['ai-summary', /METADATA_ONLY_GUARD/, '没有摘要时必须点明看不到正文，不能编造方法名/数值'],
    ['ai-summary', /NO_FABRICATION_GUARD/, '有摘要时仍须禁止在摘要之外补充事实'],
    ['ai-abstract', /NO_FABRICATION_GUARD/, '会写具体数字，必须禁止编造未提供的实验值'],
    ['ai-experiment', /NO_FABRICATION_GUARD/, '会推荐基线并给「开源代码」链接'],
    ['ai-gap-analysis', /NO_FABRICATION_GUARD/, '会输出「相关论文」'],
    ['ai-related-papers', /NO_FABRICATION_GUARD/, '会输出论文标题/作者/年份/期刊'],
    ['ai-review', /NO_FABRICATION_GUARD/, '会写文献综述并引用'],
    // ai-paper-score 给论文打「相关度/新颖度/阅读优先级」，分数直接决定那张阅读优先级榜
    ['ai-paper-score', /NO_FABRICATION_GUARD/, '打分必须基于题录与摘要，不能凭印象补方法细节'],
    ['ai-paper-score', /JSON_ONLY_GUARD/, '结构化输出必须只回 JSON，且 id 只能取自清单'],
    // ai-topic-score 给 14 个细项打分，分数直接影响「这个课题该不该做」的判断
    ['ai-topic-score', /NO_FABRICATION_GUARD/, '打分必须按课题事实，不能凭印象填数'],
    // ai-direction 用的是自带措辞（比通用版更具体），这里按原文匹配
    ['ai-direction', /不能假装查阅未提供的论文/, '选题导师必须基于本地库作答'],
  ]

  it.each(GUARDED)('src/app/api/%s/route.ts 带有防编造约束', (routePath, pattern, why) => {
    void why
    const src = readFileSync(path.resolve('src/app/api', routePath, 'route.ts'), 'utf8')
    expect(src).toMatch(pattern)
  })

  it('约束常量集中在 src/lib/llm/prompts.ts，不要在路由里各写一份', () => {
    const src = readFileSync(path.resolve('src/lib/llm/prompts.ts'), 'utf8')
    expect(src).toMatch(/export const NO_FABRICATION_GUARD\b/)
    expect(src).toMatch(/export const METADATA_ONLY_GUARD\b/)
  })
})

/**
 * 输出格式合同必须在位。
 *
 * 用户的原始反馈是「AI 的回答是把所有复制回来」—— 渲染端已改用 AiMarkdown，
 * 但如果没有这半边的格式合同，模型会继续用【】、===、全角竖线表格这类
 * 渲染端无法识别的自由格式，问题只是从「`**` 原样显示」变成「另一种原样显示」。
 * 这两半必须同时存在，所以这里按文件钉住。
 */
describe('AI 提示词：输出格式合同必须在位', () => {
  const FORMATTED = [
    'ai-summary',
    'ai-abstract',
    'ai-direction',
    'ai-experiment',
    'ai-gap-analysis',
    'ai-related-papers',
    'ai-review',
  ]

  it.each(FORMATTED)('src/app/api/%s/route.ts 引用了 OUTPUT_FORMAT_CONTRACT', (routePath) => {
    const src = readFileSync(path.resolve('src/app/api', routePath, 'route.ts'), 'utf8')
    expect(src).toMatch(/OUTPUT_FORMAT_CONTRACT/)
  })

  it('planner 的 AI 提示词只在纯文本(risk)模式拼格式合同，不给 JSON 模式添乱', () => {
    const src = readFileSync(path.resolve('src/lib/planner/ai.ts'), 'utf8')
    expect(src).toMatch(/OUTPUT_FORMAT_CONTRACT/)
    // weekly / breakdown 要求「只输出 JSON、不要 Markdown」，会被格式合同带偏 ⇒ 二者不得同时出现
    const jsonRule = src.slice(src.indexOf('const JSON_FORMAT_RULE'))
    expect(jsonRule.slice(0, 400)).not.toMatch(/OUTPUT_FORMAT_CONTRACT/)
  })

  it('JSON 模式的 AI 路由：拼 JSON_ONLY_GUARD，且**不得**拼 Markdown 格式合同', () => {
    const src = readFileSync(path.resolve('src/app/api/ai-paper-score/route.ts'), 'utf8')
    expect(src).toMatch(/JSON_ONLY_GUARD/)
    // 两条约束互斥：同时出现会让模型产出「JSON 外面裹一层 Markdown」，解析失败率上升
    expect(src).not.toMatch(/OUTPUT_FORMAT_CONTRACT/)
  })

  it('渲染端只有一份 Markdown 渲染器，且默认不渲染 raw HTML', () => {
    const src = readFileSync(path.resolve('src/components/ai-markdown.tsx'), 'utf8')
    expect(src).toMatch(/remarkGfm/)
    // react-markdown 默认忽略 raw HTML；显式断言没引入 rehype-raw（那会开启 HTML 注入面）
    expect(src).not.toMatch(/rehype-raw/)
  })
})

/**
 * 面板必须用统一渲染器，不能再退回纯文本。
 * 这是「AI 回答原样搬回来」这个 bug 的回归线：改回 `whitespace-pre-wrap` 就红。
 */
describe('AI 面板：统一使用 AiMarkdown 渲染', () => {
  const PANELS = [
    'ai-summary',
    'ai-abstract-generator',
    'ai-direction-explorer',
    'ai-experiment-advisor',
    'ai-gap-analysis',
    'ai-related-papers',
    'ai-review-generator',
  ]

  it.each(PANELS)('src/components/%s.tsx 使用 AiMarkdown', (name) => {
    const src = readFileSync(path.resolve('src/components', `${name}.tsx`), 'utf8')
    expect(src).toMatch(/<AiMarkdown\b/)
  })

  it('planner 的 AI 助手也用 AiMarkdown 渲染 risk 结果', () => {
    const src = readFileSync(path.resolve('src/components/planner/ai-assistant.tsx'), 'utf8')
    expect(src).toMatch(/<AiMarkdown\b/)
  })
})

/**
 * 「课题域」这件事必须贯穿前后端。
 *
 * 2026-09-18 用户反馈「AI 研究分析…容易在课题多了以后互相干扰」，
 * 修法是「前端选课题 → 请求体带 topicId → 服务端按课题筛」。
 * 三处缺任何一处，用户看到的都还是「全库混杂分析」，而且**不会有任何报错** ——
 * 所以这里逐处钉住，改坏了至少测试会红。
 */
describe('AI 研究分析：课题域贯穿前后端', () => {
  it('面板有课题选择控件，并把 topicId 放进请求体', () => {
    const src = readFileSync(path.resolve('src/components/ai-gap-analysis.tsx'), 'utf8')
    expect(src).toMatch(/SelectTrigger/)
    expect(src).toMatch(/topicId/)
    expect(src).toMatch(/JSON.stringify\(\{\s*type,\s*topicId/)
  })

  it('面板默认选中一个具体课题（而不是默认全库），并保留「全库综合分析」退路', () => {
    const src = readFileSync(path.resolve('src/components/ai-gap-analysis.tsx'), 'utf8')
    expect(src).toMatch(/ALL_TOPICS/)
    expect(src).toMatch(/全库综合分析/)
    // 默认选中第一个课题：list[0]
    expect(src).toMatch(/topicList\[0\]\.id/)
  })

  it('结果按「课题 + 类型」分开缓存（切课题后不能显示成新课题的结论）', () => {
    const src = readFileSync(path.resolve('src/components/ai-gap-analysis.tsx'), 'utf8')
    expect(src).toMatch(/`\$\{topicId\}:\$\{type\}`/)
  })

  it('服务端按课题域筛论文与笔记', () => {
    const src = readFileSync(path.resolve('src/app/api/ai-gap-analysis/route.ts'), 'utf8')
    expect(src).toMatch(/scopeByTopic/)
  })

  it('Paper 与 Note 都有 topicIds 字段，且桌面迁移会为老库补列', () => {
    const schema = readFileSync(path.resolve('prisma/schema.prisma'), 'utf8')
    const paperBlock = schema.slice(schema.indexOf('model Paper'), schema.indexOf('model Topic'))
    const noteBlock = schema.slice(schema.indexOf('model Note'), schema.indexOf('model SearchLog'))
    expect(paperBlock).toMatch(/topicIds\s+String\s+@default\("\[\]"\)/)
    expect(noteBlock).toMatch(/topicIds\s+String\s+@default\("\[\]"\)/)

    const migrate = readFileSync(path.resolve('desktop/migrate-database.js'), 'utf8')
    expect(migrate).toMatch(/topicIds:\s*"topicIds TEXT DEFAULT '\[\]'"/)
  })

  it('论文与笔记界面都能挂课题（否则用户没法把数据归到课题上）', () => {
    const linker = readFileSync(path.resolve('src/components/topic-linker.tsx'), 'utf8')
    expect(linker).toMatch(/export function TopicLinker/)
    for (const file of [
      'src/components/sections/papers-section.tsx',
      'src/components/sections/notes-section.tsx',
      'src/components/reading-note-editor.tsx',
    ]) {
      expect(readFileSync(path.resolve(file), 'utf8')).toMatch(/TopicLinker/)
    }
  })
})
