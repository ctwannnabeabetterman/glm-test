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

// PUT /api/settings/llm - 保存配置（apiKey 省略=保持不变；空串=清除）
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : undefined
    const model = typeof body.model === 'string' ? body.model.trim() : undefined
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
