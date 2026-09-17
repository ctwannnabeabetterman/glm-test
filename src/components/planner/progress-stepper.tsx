'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  progress: number
  /** 提交新进度；抛错由调用方负责提示 */
  onCommit: (next: number) => Promise<void> | void
  className?: string
  /** 每次点击的步长（默认 25，与旧版甘特图一致） */
  step?: number
  size?: 'sm' | 'md'
}

/**
 * ±25% 的进度步进控件。
 *
 * 抽成独立组件的原因：升级前的「进度时间线」和「写作时间线」是纯只读视图，
 * 页面上没有任何地方能把进度写进去 —— 进度条永远停在种子数据上，
 * 看起来像真的、其实永远不会动。现在这两处都挂这个控件。
 */
export function ProgressStepper({ progress, onCommit, className, step = 25, size = 'sm' }: Props) {
  const [busy, setBusy] = useState(false)

  const commit = async (delta: number) => {
    const next = Math.max(0, Math.min(100, progress + delta))
    if (next === progress || busy) return
    setBusy(true)
    try {
      await onCommit(next)
    } finally {
      setBusy(false)
    }
  }

  const btn = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-xs'

  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      <button
        type="button"
        aria-label={`进度减 ${step}%`}
        disabled={busy || progress <= 0}
        onClick={() => void commit(-step)}
        className={cn(
          'flex items-center justify-center rounded bg-background/80 border border-border/60 hover:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed',
          btn,
        )}
      >
        −
      </button>
      <button
        type="button"
        aria-label={`进度加 ${step}%`}
        disabled={busy || progress >= 100}
        onClick={() => void commit(step)}
        className={cn(
          'flex items-center justify-center rounded bg-background/80 border border-border/60 hover:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed',
          btn,
        )}
      >
        +
      </button>
    </span>
  )
}
