import { NextResponse } from 'next/server'
import { chatComplete, resolveLlmConfig } from '@/lib/llm'
import { LLM_NOT_CONFIGURED, llmFailureResponse } from '@/lib/llm/http'

// POST /api/settings/llm/test - 用最小请求测试连通性
export async function POST() {
  const resolved = await resolveLlmConfig()
  if (!resolved.hasKey) {
    // 与其余 AI 路由同一契约：未配置 ⇒ 400 + code，前端据此弹「去设置」
    return NextResponse.json(
      { ok: false, error: '未配置 API Key，请先填写并保存', code: LLM_NOT_CONFIGURED, source: resolved.source },
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
    return llmFailureResponse(e, '连通性测试失败', {
      ok: false,
      source: resolved.source,
      latencyMs: Date.now() - start,
    })
  }
}
