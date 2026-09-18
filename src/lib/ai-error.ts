import { toast } from 'sonner'
import { LLM_NOT_CONFIGURED } from '@/lib/llm/codes'
import { useAppStore } from '@/lib/store'

/**
 * AI 接口失败时的统一前端提示。
 *
 * 为什么要有这个：后端已经把所有 AI 路由的「未配置 API Key」统一成
 * 400 + `code: 'LLM_NOT_CONFIGURED'`（见 `@/lib/llm/http`）。但前端 8 个 AI 组件
 * 各写各的 `toast.error(data.error || '生成失败')` —— 用户只看到一句
 * 「尚未配置 LLM API Key：请在「设置」页填入…」，**还得自己去侧边栏找设置页**。
 *
 * 这里把这条约束变成一次点击：识别到该 code 时，toast 上直接挂「去设置」按钮，
 * 跳到设置页。其余错误仍走普通 toast。
 *
 * 用法：
 * ```ts
 * const data = await res.json()
 * if (data.success) { ... } else { toastAiError(data, '生成失败') }
 * ```
 * 或 res.ok 分支式：
 * ```ts
 * if (!res.ok) { toastAiError(data, '分析失败'); return }
 * ```
 */
export function toastAiError(
  payload: { error?: unknown; code?: unknown } | null | undefined,
  fallback = '生成失败'
) {
  const message =
    typeof payload?.error === 'string' && payload.error.trim() ? payload.error : fallback

  if (payload?.code === 'LLM_NOT_CONFIGURED') {
    toast.error(message, {
      // 这条提示用户得读两行字并做一次跳转，默认 4 秒太短
      duration: 10_000,
      action: {
        label: '去设置',
        onClick: () => useAppStore.getState().setSection('settings'),
      },
    })
    return
  }

  toast.error(message)
}
