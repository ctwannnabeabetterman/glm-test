/**
 * AI 路由的统一失败契约。
 *
 * 为什么要单独一个模块：2026-09-18 全量排查发现，9 个调用 chatComplete 的 AI 路由里
 * 只有 planner/assist 与 settings/llm/test 把「没配 API Key」翻译成了**可判定**的
 * 400 + `code`，其余 7 个一律裸 500。后果有两层：
 *  - 用户看到「服务器错误」，而真实原因其实是「功能前置条件没满足」
 *    （去设置页填个 Key 就能用，根本不是服务器坏了）；
 *  - 前端拿不到 `code`，也就没法据此弹「去设置」入口，
 *    只能把一个英文前缀的错误原样丢进 toast。
 *
 * 契约（所有调用 LLM 的路由必须一致，别再各写各的 catch）：
 *  - 未配置 Key → 400 `code: LLM_NOT_CONFIGURED`
 *    刻意不用 401：401 语义是「鉴权失败」，而这里连请求都没发出去，
 *    原因是功能前置条件缺失 ⇒ 400 更准，且前端可据此判定。
 *  - 其它失败   → 502 `code: LLM_CALL_FAILED`
 *    上游不可达 / 超时 / 非 2xx / 空回复，都属于「网关上游出错」。
 *
 * 前端侧在 `@/lib/ai-error`（据 `code` 弹「去设置」）；code 字面量放在
 * 零依赖的 `./codes` 里，两侧共用同一份常量，由 TS 保证不会改歪。
 */
import { NextResponse } from 'next/server'
import { LLM_CALL_FAILED, LLM_NOT_CONFIGURED } from './codes'
import { LlmNotConfiguredError } from './index'

export { LLM_CALL_FAILED, LLM_NOT_CONFIGURED }

/**
 * 把 LLM 调用抛出的异常映射成统一的 HTTP 响应。
 *
 * 用法（**只包住 LLM 调用本身**，不要包住取数据的 DB 查询 ——
 * 数据库出错该是 500，套上这个会变成误导性的 502 LLM_CALL_FAILED）：
 *
 * ```ts
 * let content: string
 * try {
 *   content = await chatComplete(messages, opts)
 * } catch (e) {
 *   return llmFailureResponse(e, 'AI 摘要失败')
 * }
 * ```
 *
 * @param extra 需要一并回传的字段（如 settings/llm/test 的 `ok`/`source`）。
 *              `error` 与 `code` 由本函数决定，`extra` 覆盖不了它们。
 */
export function llmFailureResponse(e: unknown, label: string, extra: Record<string, unknown> = {}) {
  if (e instanceof LlmNotConfiguredError) {
    return NextResponse.json({ ...extra, error: e.message, code: LLM_NOT_CONFIGURED }, { status: 400 })
  }
  const detail = e instanceof Error ? e.message : String(e)
  return NextResponse.json({ ...extra, error: `${label}: ${detail}`, code: LLM_CALL_FAILED }, { status: 502 })
}
