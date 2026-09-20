import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 页面标题栏 —— 全部 12 个页面共用，保证排版语言一致。
 *
 * 设计取向（学术论文风）：
 *   - 去掉彩色圆角图标底板（那是 dashboard 模板的标志）
 *   - 用「眉标 + 衬线标题 + 说明行」三级结构表达层级
 *   - 底部分割线划分区域，替代卡片边框
 *   - 图标弱化为标题前的小尺寸线性图标
 *
 * 注意：本组件保留在 papers-section 之外，收敛成独立文件
 * 以避免页面之间互相 import 造成的循环依赖。
 */
export function SectionHeader({
  title,
  desc,
  icon: Icon,
  action,
  eyebrow,
  className,
}: {
  title: string
  desc?: string
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  action?: ReactNode
  /** 可选的眉标（章节号 / 分类），如「方法论 §1.3」 */
  eyebrow?: string
  className?: string
}) {
  return (
    <header className={cn('mb-6', className)}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
          <div className="flex items-center gap-2.5">
            {Icon && (
              <Icon className="h-[18px] w-[18px] shrink-0 text-primary" strokeWidth={1.75} />
            )}
            <h1 className="page-title">{title}</h1>
          </div>
          {desc && <p className="caption mt-2 max-w-3xl">{desc}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2 pt-1">{action}</div>}
      </div>
      <hr className="rule mt-5" />
    </header>
  )
}

/**
 * 小节标题 —— 页面内部的分区标题。
 * 比 SectionHeader 低一级，通常带一条细线或极小间距。
 */
export function SubSection({
  title,
  desc,
  action,
  className,
}: {
  title: string
  desc?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 mb-3', className)}>
      <div className="min-w-0">
        <h2 className="section-title">{title}</h2>
        {desc && <p className="caption mt-0.5">{desc}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

/**
 * 空状态 —— 学术风的克制提示，不用插画和鲜艳色块。
 */
export function EmptyState({
  title,
  desc,
  action,
  className,
}: {
  title: string
  desc?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-6 py-10 text-center',
        className
      )}
    >
      <p className="text-[13px] text-muted-foreground">{title}</p>
      {desc && <p className="caption mt-1.5 max-w-md">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
