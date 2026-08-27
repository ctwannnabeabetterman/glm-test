'use client'

import { useState } from 'react'
import { SectionHeader } from './papers-section'
import {
  Rocket, LayoutGrid, Sparkles, Code2, Database, HelpCircle, BookOpen,
  ChevronRight, Copy, Check, AlertTriangle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  USAGE_DOCS,
  type DocBlock,
  type DocSection,
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
        action={<Badge variant="outline" className="text-xs">v1.0</Badge>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left: section nav (like DeepSeek docs sidebar) */}
        <aside className="lg:col-span-1">
          <nav className="lg:sticky lg:top-20 rounded-xl border border-border bg-card p-2 space-y-0.5">
            {USAGE_DOCS.map((s) => {
              const Icon = ICON_MAP[s.icon] ?? BookOpen
              const isActive = active.id === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all',
                    isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                  {s.title}
                  {isActive && <ChevronRight className="h-3.5 w-3.5 ml-auto text-primary" />}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Right: document content */}
        <article className="lg:col-span-3 rounded-xl border border-border bg-card p-6 lg:p-8">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
            <span>使用说明</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{active.title}</span>
          </div>

          {/* Section heading */}
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              {(() => {
                const Icon = ICON_MAP[active.icon] ?? BookOpen
                return <Icon className="h-5 w-5" />
              })()}
            </div>
            <div>
              <h2 className="text-xl font-bold">{active.title}</h2>
              <p className="text-xs text-muted-foreground">
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
      return <p className="text-sm leading-relaxed text-foreground/90">{block.text}</p>

    case 'note':
      return (
        <div
          className={cn(
            'rounded-lg border p-3.5 text-sm flex items-start gap-2.5',
            block.variant === 'warn'
              ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
              : 'border-primary/25 bg-primary/5 text-primary-foreground/90'
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-current opacity-80" />
          <div className="leading-relaxed">{block.text}</div>
        </div>
      )

    case 'list':
      return (
        <ul className="space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
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
      {caption && <div className="text-xs font-semibold text-muted-foreground mb-2">{caption}</div>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-foreground">{c}</th>
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
      {caption && <div className="text-xs font-semibold text-muted-foreground mb-2">{caption}</div>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold">PARAM</th>
              <th className="px-3 py-2 text-left text-xs font-semibold">VALUE</th>
              <th className="px-3 py-2 text-left text-xs font-semibold">说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 align-top">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-primary">{r.name}</code>
                </td>
                <td className="px-3 py-2 align-top">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{r.value}</code>
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
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-mono text-muted-foreground">{title || lang}</span>
        <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="bg-background p-3 overflow-x-auto text-xs font-mono leading-relaxed">
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
        <div key={i} className="rounded-lg border border-border">
          <button
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-left hover:bg-muted/20"
          >
            {item.q}
            <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', openIdx === i && 'rotate-90')} />
          </button>
          {openIdx === i && (
            <div className="px-4 pb-3 text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
              {item.a}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
