/**
 * LLM 网关 —— 接入个人 API Key，兼容任何 OpenAI 风格 Chat Completions 接口。
 *
 * 配置优先级：数据库 Setting('llm.config') > 环境变量(.env) > 默认值
 *  - 智谱 GLM:    https://open.bigmodel.cn/api/paas/v4     (默认)
 *  - DeepSeek:    https://api.deepseek.com/v1
 *  - Ollama 本地: http://localhost:11434/v1                 (apiKey 任意非空)
 *
 * OpenAI 兼容请求: POST {baseUrl}/chat/completions
 */

import { db } from '@/lib/db'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
}

export interface ResolvedLlmConfig {
  baseUrl: string
  model: string
  hasKey: boolean
  /** 当前生效配置来自哪一层 */
  source: 'database' | 'env' | 'default'
}

export const DEFAULT_LLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const DEFAULT_LLM_MODEL = 'glm-4-flash'

export const PROVIDER_PRESETS = [
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'ollama', name: 'Ollama (本地)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', keyUrl: 'https://ollama.com' },
  { id: 'custom', name: '自定义 (OpenAI 兼容)', baseUrl: '', model: '', keyUrl: '' },
] as const

export class LlmNotConfiguredError extends Error {
  code = 'LLM_NOT_CONFIGURED'
  constructor() {
    super('尚未配置 LLM API Key：请在「设置」页填入你的 API Key（推荐智谱 glm-4-flash 免费模型），或在 .env 中配置 LLM_API_KEY。')
    this.name = 'LlmNotConfiguredError'
  }
}

interface DbLlmConfig {
  baseUrl?: string
  model?: string
  apiKey?: string
}

const SETTING_KEY = 'llm.config'

async function loadDbConfig(): Promise<DbLlmConfig | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } })
    if (!row) return null
    return JSON.parse(row.value) as DbLlmConfig
  } catch {
    return null
  }
}

/** 读取最终生效配置（不含明文 Key，用于展示） */
export async function resolveLlmConfig(): Promise<ResolvedLlmConfig> {
  const dbCfg = await loadDbConfig()
  const envKey = process.env.LLM_API_KEY || ''
  const envBase = process.env.LLM_BASE_URL || ''
  const envModel = process.env.LLM_MODEL || ''

  if (dbCfg && (dbCfg.apiKey || dbCfg.baseUrl || dbCfg.model)) {
    return {
      baseUrl: dbCfg.baseUrl || envBase || DEFAULT_LLM_BASE_URL,
      model: dbCfg.model || envModel || DEFAULT_LLM_MODEL,
      hasKey: Boolean(dbCfg.apiKey || envKey),
      source: 'database',
    }
  }
  if (envKey || envBase || envModel) {
    return {
      baseUrl: envBase || DEFAULT_LLM_BASE_URL,
      model: envModel || DEFAULT_LLM_MODEL,
      hasKey: Boolean(envKey),
      source: 'env',
    }
  }
  return { baseUrl: DEFAULT_LLM_BASE_URL, model: DEFAULT_LLM_MODEL, hasKey: false, source: 'default' }
}

/** 获取完整配置（含明文 Key），仅在服务端调用 */
async function requireLlmConfig(): Promise<LlmConfig> {
  const dbCfg = await loadDbConfig()
  const apiKey = dbCfg?.apiKey || process.env.LLM_API_KEY || ''
  const baseUrl = (dbCfg?.baseUrl || process.env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL).replace(/\/+$/, '')
  const model = dbCfg?.model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL
  if (!apiKey) throw new LlmNotConfiguredError()
  return { baseUrl, model, apiKey }
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  /** 秒；默认 120 */
  timeoutMs?: number
}

/**
 * 调用 Chat Completions，返回首个回复文本。
 * 所有 AI 路由统一走这里，换服务商只改配置。
 */
export async function chatComplete(messages: LlmMessage[], options: ChatOptions = {}): Promise<string> {
  const cfg = await requireLlmConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000)
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = text.slice(0, 300)
      try {
        const err = JSON.parse(text)
        detail = err?.error?.message || err?.message || detail
      } catch { /* 保留原始文本 */ }
      throw new Error(`LLM 接口返回 ${res.status}：${detail || res.statusText}`)
    }

    const data = await res.json()
    const content: string | undefined = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM 返回了空回复')
    return content
  } catch (e) {
    if (e instanceof LlmNotConfiguredError) throw e
    const err = e as Error
    if (err.name === 'AbortError') throw new Error('LLM 请求超时，请检查网络或 Base URL 可达性')
    if (err.cause && typeof err.cause === 'object' && 'code' in err.cause) {
      const code = String((err.cause as { code: unknown }).code)
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        throw new Error(`无法连接 LLM 服务（${code}）：请检查 Base URL 是否正确、本地服务是否已启动`)
      }
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** 保存设置（apiKey 传 undefined 表示保持不变，传空字符串表示清除） */
export async function saveLlmConfig(input: { baseUrl?: string; model?: string; apiKey?: string }): Promise<void> {
  const current = (await loadDbConfig()) || {}
  const next: DbLlmConfig = {
    baseUrl: input.baseUrl !== undefined ? input.baseUrl.trim() : current.baseUrl,
    model: input.model !== undefined ? input.model.trim() : current.model,
    apiKey: input.apiKey !== undefined ? input.apiKey.trim() : current.apiKey,
  }
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  })
}

/** Key 脱敏展示：只留前 4 后 4 */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}
