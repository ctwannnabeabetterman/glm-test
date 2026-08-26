import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// db 层 mock：resolveLlmConfig / saveLlmConfig 只经由 db.setting 访问存储
const findUniqueMock = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    setting: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: vi.fn(async ({ update }: { update: { value: string } }) => ({ value: update.value })),
    },
  },
}))

import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  LlmNotConfiguredError,
  PROVIDER_PRESETS,
  chatComplete,
  maskKey,
  resolveLlmConfig,
} from '@/lib/llm'

const ENV_BACKUP = { ...process.env }

beforeEach(() => {
  findUniqueMock.mockReset()
  delete process.env.LLM_API_KEY
  delete process.env.LLM_BASE_URL
  delete process.env.LLM_MODEL
})

afterEach(() => {
  process.env = { ...ENV_BACKUP }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function dbRow(value: unknown) {
  findUniqueMock.mockResolvedValue({ key: 'llm.config', value: JSON.stringify(value) })
}

describe('llm：BYO-Key 网关', () => {
  it('maskKey 脱敏规则：留前 4 后 4，短 Key 全遮蔽', () => {
    expect(maskKey('abcd12345678ef90')).toBe('abcd****ef90')
    expect(maskKey('shortkey')).toBe('****')
    expect(maskKey('')).toBe('')
  })

  it('未配置任何来源时 resolveLlmConfig 返回 default 且 hasKey=false', async () => {
    findUniqueMock.mockResolvedValue(null)
    const cfg = await resolveLlmConfig()
    expect(cfg.source).toBe('default')
    expect(cfg.hasKey).toBe(false)
    expect(cfg.baseUrl).toBe(DEFAULT_LLM_BASE_URL)
    expect(cfg.model).toBe(DEFAULT_LLM_MODEL)
  })

  it('配置优先级：数据库 > 环境变量 > 默认', async () => {
    findUniqueMock.mockResolvedValue(null)
    process.env.LLM_API_KEY = 'env-key'
    process.env.LLM_BASE_URL = 'https://env.example/v1/'
    const envCfg = await resolveLlmConfig()
    expect(envCfg.source).toBe('env')
    expect(envCfg.hasKey).toBe(true)

    dbRow({ baseUrl: 'https://db.example/v4', model: 'db-model', apiKey: 'db-key' })
    const dbCfg = await resolveLlmConfig()
    expect(dbCfg.source).toBe('database')
    expect(dbCfg.baseUrl).toBe('https://db.example/v4')
    expect(dbCfg.model).toBe('db-model')
    expect(dbCfg.hasKey).toBe(true)
  })

  it('数据库行存在但为空对象时回落到 env/default，且不泄露明文 Key', async () => {
    dbRow({})
    const cfg = await resolveLlmConfig()
    expect(cfg.source).toBe('default')
    expect(JSON.stringify(cfg)).not.toContain('secret')
  })

  it('PROVIDER_PRESETS 含智谱默认预设与免费模型推荐', () => {
    const zhipu = PROVIDER_PRESETS.find((p) => p.id === 'zhipu')
    expect(zhipu).toBeDefined()
    expect(zhipu!.baseUrl).toContain('bigmodel.cn')
    expect(zhipu!.model).toBe(DEFAULT_LLM_MODEL)
  })

  it('chatComplete：URL 拼接去尾部斜杠、Bearer 头、正常解析首个回复', async () => {
    dbRow({ baseUrl: 'https://api.example.com/v1/', model: 'test-model', apiKey: 'k-1234' })
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      void init
      return new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    const reply = await chatComplete([{ role: 'user', content: 'ping' }])
    expect(reply).toBe('pong')
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions') // 尾斜杠已去除
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k-1234')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('test-model')
    expect(body.stream).toBe(false)
  })

  it('chatComplete：上游非 2xx 时提取 error.message 抛中文错误（401 场景）', async () => {
    dbRow({ apiKey: 'bad-key' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: '令牌已过期或验证不正确' } }), { status: 401 }))
    )
    await expect(chatComplete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401.*令牌已过期/)
  })

  it('无 Key 时 chatComplete 抛 LlmNotConfiguredError（不发请求）', async () => {
    findUniqueMock.mockResolvedValue(null)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(chatComplete([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(LlmNotConfiguredError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('空回复与连接拒绝均有明确中文错误', async () => {
    dbRow({ apiKey: 'k' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })))
    await expect(chatComplete([{ role: 'user', content: 'hi' }])).rejects.toThrow('空回复')

    const refused = new TypeError('fetch failed')
    ;(refused as Error & { cause: unknown }).cause = { code: 'ECONNREFUSED' }
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw refused
    }))
    await expect(chatComplete([{ role: 'user', content: 'hi' }])).rejects.toThrow('ECONNREFUSED')
  })
})
