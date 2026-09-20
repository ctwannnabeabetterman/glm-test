'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { applyResultDensity } from '@/lib/result-density'

/**
 * 把「外观类偏好」落到 <html> 上。
 *
 * 目前有两项：主题（`.dark` class）与 AI 结果密度（`data-result-density`）。
 * 原本这里只做主题，叫 ThemeManager；结果密度也是同一类事
 * （读 store → 写一个 html 属性 → 全局 CSS 跟着变），所以合成一个组件，
 * 避免以后每加一项外观偏好就多一个只在 app-shell 里挂一次的幽灵组件。
 *
 * 都是幂等的属性写入，不触发 React 重渲染：
 * 页面上已经渲染好的 AI 结果靠 CSS 变量立刻跟着变，不会闪一下重排。
 */
export function AppearanceManager() {
  const theme = useAppStore((s) => s.theme)
  const resultDensity = useAppStore((s) => s.resultDensity)

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  useEffect(() => {
    applyResultDensity(resultDensity)
  }, [resultDensity])

  return null
}
