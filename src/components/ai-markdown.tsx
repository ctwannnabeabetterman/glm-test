'use client'

import { memo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/**
 * AI 输出的统一渲染器。
 *
 * 为什么要有这个：8 个 AI 面板此前各写各的 `<div className="whitespace-pre-wrap">{result}</div>`
 * —— 纯文本渲染，而提示词却要求模型输出 `**加粗**` 与 Markdown 表格。
 * 用户看到的就是「所有符号原样搬回来」。这里把渲染收成一份：
 *   - 真的渲染 Markdown（标题/列表/加粗/行内代码/表格/引用/分隔线）
 *   - 明确**不启用** raw HTML（react-markdown 默认如此）—— 模型输出属于不可信内容，
 *     绝不能让它往页面里注入标签
 *   - 链接强制 `target="_blank"` + `rel="noreferrer"`，且只放行 http/https
 *   - 字号/间距按面板场景成档，避免每个面板再调一遍
 */

interface AiMarkdownProps {
  /** 模型返回的 Markdown 原文 */
  content: string
  /**
   * 成档：【compact】用于侧栏/小抽屉内的小字号结果；【default】用于主内容区。
   */
  size?: 'compact' | 'default' | 'loose'
  className?: string
}

/** 由 h1 降一级开始的映射：面板内容本身就是卡片内区块，`#` 是「本文档根标题」的语义，
 *  直接渲染成 h1 会把布局撑爆。这里统一把标题整体下压一级（h1→h2，h2→h3…）。 */
const HEADING_SHIFT: Record<string, 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = {
  h1: 'h2',
  h2: 'h3',
  h3: 'h4',
  h4: 'h5',
  h5: 'h6',
  h6: 'h6',
}

const SIZE_STYLES: Record<NonNullable<AiMarkdownProps['size']>, { base: string; table: string }> = {
  compact: { base: 'text-[11px] leading-relaxed', table: 'text-[10px]' },
  default: { base: 'text-xs leading-relaxed', table: 'text-[11px]' },
  loose: { base: 'text-sm leading-relaxed', table: 'text-xs' },
}

/** 只放行 http/https 的绝对链接，其余（javascript:、data: 等）一律不渲染成链接 */
function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href, 'https://placeholder.invalid')
    return url.protocol === 'http:' || url.protocol === 'https:' ? href : undefined
  } catch {
    return undefined
  }
}

const LINK_REL = 'noopener noreferrer'

export const AiMarkdown = memo(function AiMarkdown({ content, size = 'default', className }: AiMarkdownProps) {
  const s = SIZE_STYLES[size]
  return (
    <div className={cn('ai-markdown', s.base, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 标题整体下压一级，并保持紧凑（面板里不需要 h1 那种体量）
          h1: ({ children }) => <h2 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h2>,
          h2: ({ children }) => <h3 className="mb-1.5 mt-3 text-[13px] font-semibold first:mt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1 mt-2.5 font-semibold first:mt-0">{children}</h4>,
          h4: ({ children }) => <h5 className="mb-1 mt-2 font-semibold first:mt-0">{children}</h5>,
          h5: ({ children }) => <h6 className="mb-1 mt-2 font-semibold first:mt-0">{children}</h6>,
          h6: ({ children }) => <h6 className="mb-1 mt-2 font-semibold first:mt-0">{children}</h6>,

          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,

          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-4 first:mt-0 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-4 first:mt-0 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,

          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="line-through opacity-70">{children}</del>,

          a: ({ href, children }) => {
            const safe = safeHref(href)
            return safe ? (
              <a href={safe} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            )
          },

          code: ({ children, className: codeClassName }) => {
            // 有 language-* 的是围栏代码块，交给 pre 处理
            const isBlock = Boolean(codeClassName)
            return isBlock ? (
              <code className="font-mono">{children}</code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded border border-border bg-muted/40 p-2 font-mono text-[0.9em] first:mt-0 last:mb-0">
              {children}
            </pre>
          ),

          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-2.5 text-muted-foreground first:mt-0 last:mb-0">
              {children}
            </blockquote>
          ),

          hr: () => <hr className="my-3 border-border" />,

          // 表格：这是 5 个面板的主要输出形式，横向可滚动避免撑破面板
          table: ({ children }) => (
            <div className="my-2 w-full overflow-x-auto first:mt-0 last:mb-0">
              <table className={cn('w-full border-collapse', s.table)}>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-medium whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

/** 供非组件场景（如测试）复用的标题降级表 */
export function shiftHeading(level: keyof typeof HEADING_SHIFT): ReactNode {
  return HEADING_SHIFT[level]
}
