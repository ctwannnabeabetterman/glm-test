'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SectionHeader } from '@/components/section-header'
import { METHODOLOGY_MODULES, type MethodologyModule } from '@/lib/methodology-data'
import { ResearchStatsDashboard } from '@/components/research-stats-dashboard'
import {
  GraduationCap,
  ChevronRight,
  ChevronDown,
  FileCode,
  Target,
  CheckSquare,
  BookOpen,
  Layers,
  ArrowRight,
  Copy,
  Code,
  CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { toast } from 'sonner'

export function MethodologySection() {
  const [expanded, setExpanded] = useState<number | null>(1)
  const setSection = useAppStore((s) => s.setSection)

  const toggle = (id: number) => setExpanded(expanded === id ? null : id)

  return (
    <div className="space-y-4">
      <SectionHeader
        title="方法论浏览"
        desc="AI 通信组网科研方法论 6 大模块完整指南"
        icon={GraduationCap}
      />

      {/* Research Statistics Dashboard */}
      <ResearchStatsDashboard />

      {/* Overview card */}
      <Card className="border-l-2 border-l-primary/60 bg-card py-0">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-accent text-accent-foreground shrink-0" aria-hidden="true">
              <BookOpen className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="flex-1">
              <h2 className="section-title mb-1">AI 通信组网科研方法论 — 完整指南</h2>
              <div className="prose-research text-[13px] text-muted-foreground">
                合并自 6 个模块的全部内容。适用对象：通信组网方向硕士研究生。工具栈：Python + MATLAB。前置基础：信号处理、通信原理、移动通信、LSTM/RL 基础。
              </div>
              <nav className="flex items-center gap-2 mt-3 flex-wrap" aria-label="方法论模块">
                {METHODOLOGY_MODULES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-current={expanded === m.id ? 'true' : undefined}
                    onClick={() => { setExpanded(m.id); document.getElementById(`module-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[12px] font-medium transition-colors',
                      expanded === m.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-primary/30 bg-accent/50 text-accent-foreground hover:bg-accent',
                    )}
                  >
                    <span className="tabular font-mono font-semibold">M{m.id}</span>
                    {m.title}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modules */}
      <div className="space-y-3">
        {METHODOLOGY_MODULES.map((m) => (
          <ModuleCard
            key={m.id}
            module={m}
            expanded={expanded === m.id}
            onToggle={() => toggle(m.id)}
            onNavigate={(target) => setSection(target)}
          />
        ))}
      </div>
    </div>
  )
}

const NAV_MAP: Record<string, 'overview' | 'papers' | 'search' | 'topics' | 'experiments' | 'planner' | 'writing' | 'notes' | 'methodology'> = {
  '1.1': 'overview',
  '1.2': 'search',
  '1.3': 'topics',
  '1.4': 'planner',
  '2.1': 'search',
  '2.2': 'papers',
  '2.3': 'papers',
  '2.4': 'writing',
  '3.1': 'experiments',
  '3.2': 'experiments',
  '3.3': 'experiments',
  '3.4': 'experiments',
  '4.1': 'methodology',
  '4.2': 'methodology',
  '4.3': 'writing',
  '4.4': 'planner',
  '5.1': 'writing',
  '5.2': 'planner',
  '5.3': 'writing',
  '6.1': 'planner',
  '6.2': 'writing',
  '6.3': 'writing',
  '6.4': 'planner',
}

function ModuleCard({ module: m, expanded, onToggle, onNavigate }: {
  module: MethodologyModule
  expanded: boolean
  onToggle: () => void
  onNavigate: (target: 'overview' | 'papers' | 'search' | 'topics' | 'experiments' | 'planner' | 'writing' | 'notes' | 'methodology') => void
}) {
  return (
    <Card id={`module-${m.id}`} className={cn('overflow-hidden transition-colors', expanded && 'border-primary/40')}>
      {/* 整个题头仍可点击展开（鼠标）；标题本身是无处理器的 button，click / Enter 冒泡到 CardHeader，
          让键盘与读屏用户也能展开，并通过 aria-expanded 知道当前状态 */}
      <CardHeader className="pb-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'tabular flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border font-mono text-[13px] font-semibold',
              expanded ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary',
            )}
            aria-hidden="true"
          >
            M{m.id}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle>
                <h2 className="font-serif text-base font-semibold">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`module-${m.id}-body`}
                    className="rounded-sm text-left hover:text-primary"
                  >
                    {m.title}
                  </button>
                </h2>
              </CardTitle>
              <Badge variant="outline" className="tabular rounded-sm text-[11px] font-normal text-muted-foreground">
                <Layers className="h-3 w-3 mr-0.5" aria-hidden="true" />
                {m.sections.length} 节
              </Badge>
              <Badge variant="outline" className="tabular rounded-sm text-[11px] font-normal text-muted-foreground">
                <FileCode className="h-3 w-3 mr-0.5" aria-hidden="true" />
                {m.scripts.length} 脚本
              </Badge>
            </div>
            <p className="caption mt-1">{m.goal}</p>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          )}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent id={`module-${m.id}-body`} className="pt-0 space-y-4">
          {/* Sections */}
          <div>
            <h3 className="eyebrow mb-2 flex items-center gap-1.5">
              <Target className="h-3 w-3" aria-hidden="true" />
              章节内容
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {m.sections.map((s) => {
                const navTarget = NAV_MAP[s.id]
                return (
                  <div key={s.id} className="list-row card-hover group p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="tabular rounded-sm text-[11px] font-mono font-normal border-primary/30 bg-accent text-accent-foreground">{s.id}</Badge>
                      <span className="text-xs font-medium flex-1">{s.title}</span>
                      {navTarget && navTarget !== 'methodology' && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onNavigate(navTarget) }}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-primary hover:text-primary/80 transition-opacity"
                          title={`跳转到${navTarget}`}
                          aria-label={`跳转到${navTarget}：${s.title}`}
                        >
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="text-[12px] text-muted-foreground leading-relaxed">{s.summary}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Scripts */}
          <div>
            <h3 className="eyebrow mb-2 flex items-center gap-1.5">
              <FileCode className="h-3 w-3" aria-hidden="true" />
              Python 脚本索引
              <span className="ml-1 normal-case tracking-normal text-[11px] font-normal">（点击查看代码示例）</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {m.scripts.map((s) => (
                <ScriptCard key={s.name} name={s.name} desc={s.desc} code={s.code} />
              ))}
            </div>
          </div>

          {/* Deliverables */}
          <div>
            <h3 className="eyebrow mb-2 flex items-center gap-1.5">
              <CheckSquare className="h-3 w-3" aria-hidden="true" />
              模块交付清单
            </h3>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {m.deliverables.map((d, i) => (
                <li key={i} className="flex items-center gap-2 rounded-sm p-1.5">
                  {/* 原 8px 勾号低于可读下限 */}
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary/40 text-primary text-[11px] leading-none" aria-hidden="true">✓</span>
                  <span className="text-xs">{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// Script card with expandable code view
function ScriptCard({ name, desc, code }: { name: string; desc: string; code?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    if (!code) return
    navigator.clipboard.writeText(code)
    setCopied(true)
    toast.success('代码已复制')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn(
      'list-row p-2',
      code && 'card-hover cursor-pointer',
      expanded && 'md:col-span-2 lg:col-span-3 border-primary/40'
    )}
    onClick={() => code && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <FileCode className="h-3 w-3 text-primary shrink-0" aria-hidden="true" />
        {/* 展开区内有复制按钮 ⇒ 外层保持 div；脚本名用无处理器的 button 承载键盘焦点，click 冒泡到外层 */}
        {code ? (
          <button
            type="button"
            aria-expanded={expanded}
            className="min-w-0 flex-1 truncate rounded-sm text-left font-mono text-[12px] font-medium text-primary"
          >
            {name}
          </button>
        ) : (
          <code className="text-[12px] font-mono font-medium text-primary flex-1 truncate">{name}</code>
        )}
        {code && (
          <Badge variant="outline" className="rounded-sm text-[11px] font-normal py-0 px-1 shrink-0 text-muted-foreground">
            <Code className="h-3 w-3 mr-0.5" aria-hidden="true" />
            代码
          </Badge>
        )}
      </div>
      <div className="text-[12px] leading-relaxed text-muted-foreground">{desc}</div>

      {expanded && code && (
        <div className="mt-2 animate-fade-in cursor-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-muted-foreground">Python 代码示例</span>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              {copied ? (
                <><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> 已复制</>
              ) : (
                <><Copy className="h-3 w-3" aria-hidden="true" /> 复制</>
              )}
            </button>
          </div>
          <pre className="rounded-sm bg-muted/50 border border-border p-2.5 text-[12px] font-mono overflow-x-auto whitespace-pre leading-relaxed">
            {code}
          </pre>
        </div>
      )}
    </div>
  )
}
