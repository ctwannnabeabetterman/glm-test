import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PROVIDER_PRESETS, maskKey, resolveLlmConfig, saveLlmConfig } from '@/lib/llm'

async function currentKeyHint(): Promise<string> {
  try {
    const row = await db.setting.findUnique({ where: { key: 'llm.config' } })
    if (!row) return ''
    const cfg = JSON.parse(row.value) as { apiKey?: string }
    return maskKey(cfg.apiKey || '')
  } catch {
    return ''
  }
}

// GET /api/settings/llm - 当前生效的 LLM 配置（Key 脱敏）
export async function GET() {
  const resolved = await resolveLlmConfig()
  const keyHint = await currentKeyHint()
  return NextResponse.json({
    ...resolved,
    keyHint,
    envKeyConfigured: Boolean(process.env.LLM_API_KEY),
    presets: PROVIDER_PRESETS,
  })
}

/**
 * Base URL 只允许 http(s) 绝对地址。
 *
 * 这是**唯一**能拦住「少写 https:// 」的地方：settings 页那个 Base URL 是自由输入框，
 * 存进去之后 `chatComplete` 会拼成 `open.bigmodel.cn/api/paas/v4/chat/completions`
 * 交给 fetch —— fetch 直接抛 `TypeError: Failed to parse URL`，而那时错误已经脱离
 * 「配置写错了」这个语境，用户看到的是每个 AI 功能都以一句难懂的 URL 错误失败。
 * 在入口处挡掉，报错才有指向性。
 */
const BASE_URL_PATTERN = /^https?:\/\/\S+$/i

// PUT /api/settings/llm - 保存配置（apiKey 省略=保持不变；空串=清除）
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : undefined
    const model = typeof body.model === 'string' ? body.model.trim() : undefined
    // 空串是合法的：表示「不覆盖」，回落 env/default（见 lib/llm 的 requireLlmConfig）
    if (baseUrl && !BASE_URL_PATTERN.test(baseUrl)) {
      // 不带 code：与 notes / planner 导出的其它入参校验一致（那些 400 也只有一个可读 error）
      return NextResponse.json(
        { error: 'Base URL 必须以 http:// 或 https:// 开头，例如 https://open.bigmodel.cn/api/paas/v4' },
        { status: 400 }
      )
    }
    let apiKey: string | undefined
    if (typeof body.apiKey === 'string') {
      apiKey = body.apiKey
    } else if (body.clearApiKey === true) {
      apiKey = ''
    }
    await saveLlmConfig({ baseUrl, model, apiKey })
    const resolved = await resolveLlmConfig()
    return NextResponse.json({ success: true, ...resolved, keyHint: await currentKeyHint() })
  } catch (e) {
    return NextResponse.json({ error: '保存失败: ' + (e as Error).message }, { status: 500 })
  }
}
