import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
 * 卡片面板题头 —— 放在 `<Card>` 里替代「彩色图标 + CardTitle + CardDescription」旧写法。
 * 与 SectionHeader 同一套排版语言（眉标 + 标题 + 说明），但低一级：
 *   SectionHeader = 页面 h1，SubSection = 页内无卡片的 h2，PanelHeader = 卡片内的标题。
 *
 * `as` 默认 h2；嵌套在页内小节下时可传 h3，保持标题层级连续。
 * ⚠️ 不要传 h1：每页只能有一个 h1（SectionHeader / 总览题头），e2e 按 level:1 断言。
 */
export function PanelHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
  as: Heading = 'h2',
  className,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  as?: 'h2' | 'h3'
  className?: string
}) {
  return (
    <CardHeader className={cn('pb-1', action && 'grid-cols-[1fr_auto]', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <CardTitle>
          <Heading className="section-title flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />}
            {title}
          </Heading>
        </CardTitle>
        {description && <CardDescription className="caption mt-1">{description}</CardDescription>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 self-start">{action}</div>}
    </CardHeader>
  )
}

/**
 * 方法论说明条 / 提示条 —— 左侧强调竖线 + 中性底，替代原先「每张提示卡一种颜色」。
 * `tone="warning"` 只用于真正需要用户警惕的内容（走 destructive 令牌）。
 * `<strong>` 自动用墨色加粗，调用处不必再写颜色。
 */
export function MethodNote({
  children,
  action,
  icon: Icon,
  tone = 'default',
  className,
}: {
  children: ReactNode
  action?: ReactNode
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  tone?: 'default' | 'warning'
  className?: string
}) {
  const warning = tone === 'warning'
  return (
    <Card
      role={warning ? 'alert' : undefined}
      className={cn(
        'border-l-2 py-0',
        warning ? 'border-l-destructive/70 border-destructive/30 bg-destructive/5' : 'border-l-primary/60 bg-muted/30',
        className
      )}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs leading-relaxed text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {Icon && (
            <Icon
              className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', warning ? 'text-destructive' : 'text-primary')}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0 [&_strong]:font-semibold [&_strong]:text-foreground">{children}</div>
        </div>
        {action}
      </CardContent>
    </Card>
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
