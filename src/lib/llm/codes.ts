/**
 * AI 失败响应的 `code` 常量。
 *
 * 单独成一个零依赖模块（**不 import `next/server`**），是为了让服务端
 * （`./http`，含 NextResponse）和浏览器端（`@/lib/ai-error`，含 sonner/store）
 * 都能引用同一份字面量 —— 否则只能靠两边各写一遍字符串 + 一个 grep 测试来兜底。
 * 这里用 TS 常量直接锁死，谁改了名都会在编译期炸。
 */
export const LLM_NOT_CONFIGURED = 'LLM_NOT_CONFIGURED'
export const LLM_CALL_FAILED = 'LLM_CALL_FAILED'

export type LlmErrorCode = typeof LLM_NOT_CONFIGURED | typeof LLM_CALL_FAILED
