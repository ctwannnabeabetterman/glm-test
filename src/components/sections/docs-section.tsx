'use client'

import { useState } from 'react'
import { SectionHeader } from '@/components/section-header'
import {
  Rocket, LayoutGrid, Sparkles, Code2, Database, HelpCircle, BookOpen,
  ChevronRight, Copy, Check, AlertTriangle, Info,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  USAGE_DOCS,
  type DocBlock,
  type DocParam,
} from '@/lib/usage-docs-data'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  rocket: Rocket,
  grid: LayoutGrid,
  sparkles: Sparkles,
  code: Code2,
  database: Database,
  help: HelpCircle,
}

/** 技术应用说明书 —— 结构化文档页（DeepSeek API 文档风格） */
export function DocsSection() {
  const [activeId, setActiveId] = useState(USAGE_DOCS[0].id)
  const active = USAGE_DOCS.find((s) => s.id === activeId) ?? USAGE_DOCS[0]

  return (
    <div className="space-y-4">
      <SectionHeader
        title="使用说明"
        desc="Technology User Guide —— 快速上手、模块地图、AI 接入、API 速查、数据备份与 FAQ"
        icon={BookOpen}
        action={<Badge variant="outline" className="rounded-sm font-mono text-xs font-normal">v1.0</Badge>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left: section nav —— 与主侧边栏同一套选中态（左侧 2px 强调竖条 + 浅底） */}
        <aside className="lg:col-span-1">
          <nav aria-label="使用说明目录" className="lg:sticky lg:top-20 rounded-md border border-border bg-card p-2 space-y-px">
            {USAGE_DOCS.map((s) => {
              const Icon = ICON_MAP[s.icon] ?? BookOpen
              const isActive = active.id === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveId(s.id)}
                  className={cn(
                    'relative flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm transition-colors',
                    'before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-transparent',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium before:bg-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} aria-hidden="true" />
                  {s.title}
                  {isActive && <ChevronRight className="h-3.5 w-3.5 ml-auto text-primary" aria-hidden="true" />}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Right: document content */}
        <article className="lg:col-span-3 rounded-md border border-border bg-card p-6 lg:p-8">
          {/* Breadcrumb */}
          <nav aria-label="面包屑" className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
            <span>使用说明</span>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            <span className="text-foreground font-medium" aria-current="page">{active.title}</span>
          </nav>

          {/* Section heading（h2：本页 h1 是 SectionHeader「使用说明」） */}
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-accent text-accent-foreground shrink-0" aria-hidden="true">
              {(() => {
                const Icon = ICON_MAP[active.icon] ?? BookOpen
                return <Icon className="h-5 w-5" />
              })()}
            </div>
            <div>
              <h2 className="font-serif text-xl font-semibold tracking-tight">{active.title}</h2>
              <p className="caption">
                AI Network Lab · 技术应用说明书
              </p>
            </div>
          </div>

          {/* Body blocks */}
          <div className="space-y-6">
            {active.body.map((block, i) => (
              <RenderBlock key={i} block={block} />
            ))}
          </div>
        </article>
      </div>
    </div>
  )
}

function RenderBlock({ block }: { block: DocBlock }) {
  switch (block.type) {
    case 'para':
      /* 长文正文走衬线 + 宽松行高（.prose-research），与设计令牌一致 */
      return <p className="prose-research text-[14px] text-foreground/90">{block.text}</p>

    case 'note': {
      const warn = block.variant === 'warn'
      return (
        <div
          role={warn ? 'note' : undefined}
          className={cn(
            'rounded-sm border border-l-2 p-3.5 text-sm flex items-start gap-2.5',
            warn
              ? 'border-destructive/30 border-l-destructive/70 bg-destructive/5 text-destructive'
              : /* ⚠️ 原先是 text-primary-foreground/90：浅色主题下是近白字配浅底，几乎看不见 */
                'border-border border-l-primary/60 bg-muted/30 text-foreground'
          )}
        >
          {warn ? (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
          )}
          <div className="leading-relaxed">{block.text}</div>
        </div>
      )
    }

    case 'list':
      return (
        <ul className="space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      )

    case 'table':
      return <DocTable caption={block.caption} columns={block.columns} rows={block.rows} />

    case 'params':
      return <ParamTable caption={block.caption} rows={block.rows} />

    case 'code':
      return <CodeBlock lang={block.lang} title={block.title} content={block.content} />

    case 'faq':
      return <FaqList items={block.items} />

    default:
      return null
  }
}

function DocTable({ caption, columns, rows }: { caption?: string; columns: string[]; rows: string[][] }) {
  return (
    <div>
      {caption && <div className="eyebrow mb-2">{caption}</div>}
      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {columns.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-left text-xs font-semibold text-foreground">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                {row.map((cell, j) => (
                  <td key={j} className={cn('px-3 py-2 text-xs align-top', j === 0 ? 'font-medium whitespace-nowrap' : 'text-muted-foreground')}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ParamTable({ caption, rows }: { caption?: string; rows: DocParam[] }) {
  return (
    <div>
      {caption && <div className="eyebrow mb-2">{caption}</div>}
      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th scope="col" className="px-3 py-2 text-left font-mono text-[11px] font-semibold tracking-wide">PARAM</th>
              <th scope="col" className="px-3 py-2 text-left font-mono text-[11px] font-semibold tracking-wide">VALUE</th>
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold">说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 align-top">
                  <code className="rounded-sm bg-accent px-1.5 py-0.5 text-xs font-mono text-accent-foreground">{r.name}</code>
                </td>
                <td className="px-3 py-2 align-top">
                  <code className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-mono break-all">{r.value}</code>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CodeBlock({ lang, title, content }: { lang: string; title?: string; content: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard 不可用时忽略 */
    }
  }
  return (
    <div className="overflow-hidden rounded-sm border border-border">
      <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5 border-b border-border">
        <span className="text-[11px] font-mono text-muted-foreground">{title || lang}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-live="polite"
          className="flex items-center gap-1 rounded-sm text-[12px] text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-primary" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="bg-background p-3 overflow-x-auto text-[13px] font-mono leading-relaxed">
        <code>{content}</code>
      </pre>
    </div>
  )
}

function FaqList({ items }: { items: { q: string; a: string }[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0)
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="list-row">
          <button
            type="button"
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            aria-expanded={openIdx === i}
            aria-controls={`faq-answer-${i}`}
            className="flex w-full items-center justify-between gap-3 rounded-sm px-4 py-3 text-sm font-medium text-left hover:bg-muted/40"
          >
            {item.q}
            <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', openIdx === i && 'rotate-90')} aria-hidden="true" />
          </button>
          {openIdx === i && (
            <div id={`faq-answer-${i}`} className="prose-research px-4 pb-3 text-[14px] text-muted-foreground border-t border-border/50 pt-3">
              {item.a}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
