import { NextResponse } from 'next/server'
import { LlmNotConfiguredError, chatComplete, resolveLlmConfig } from '@/lib/llm'

// POST /api/settings/llm/test - 用最小请求测试连通性
export async function POST() {
  const resolved = await resolveLlmConfig()
  if (!resolved.hasKey) {
    return NextResponse.json(
      { ok: false, error: '未配置 API Key，请先填写并保存', source: resolved.source },
      { status: 400 }
    )
  }
  const start = Date.now()
  try {
    const reply = await chatComplete(
      [{ role: 'user', content: '请只回复两个字：连通' }],
      { maxTokens: 16, temperature: 0, timeoutMs: 30_000 }
    )
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - start,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      reply: reply.slice(0, 50),
    })
  } catch (e) {
    if (e instanceof LlmNotConfiguredError) {
      return NextResponse.json({ ok: false, error: e.message, source: resolved.source }, { status: 400 })
    }
    return NextResponse.json(
      { ok: false, error: (e as Error).message, latencyMs: Date.now() - start },
      { status: 502 }
    )
  }
}
