import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * 用 useSyncExternalStore 订阅 matchMedia：
 * 快照式读取替代「effect 内同步 setIsMobile」，
 * 无级联渲染告警，且天然处理 SSR 水合（服务端快照恒为 false）。
 */
export function useIsMobile() {
  const subscribe = React.useCallback((onChange: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  const getSnapshot = React.useCallback(
    () => window.innerWidth < MOBILE_BREAKPOINT,
    []
  )

  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
