'use client'

import { useState } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionHeader } from './papers-section'
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
      <Card className="bg-gradient-to-br from-primary/8 via-primary/4 to-transparent border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold mb-1">AI 通信组网科研方法论 — 完整指南</div>
              <div className="text-xs text-muted-foreground">
                合并自 6 个模块的全部内容。适用对象：通信组网方向硕士研究生。工具栈：Python + MATLAB。前置基础：信号处理、通信原理、移动通信、LSTM/RL 基础。
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {METHODOLOGY_MODULES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setExpanded(m.id); document.getElementById(`module-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors"
                  >
                    <span className="font-bold">M{m.id}</span>
                    {m.title}
                  </button>
                ))}
              </div>
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
    <Card id={`module-${m.id}`} className={cn('overflow-hidden transition-all', expanded && 'ring-1 ring-primary/30')}>
      <CardHeader className="pb-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-bold text-lg">
            M{m.id}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">{m.title}</CardTitle>
              <Badge variant="outline" className="text-[10px]">
                <Layers className="h-2.5 w-2.5 mr-0.5" />
                {m.sections.length} 节
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <FileCode className="h-2.5 w-2.5 mr-0.5" />
                {m.scripts.length} 脚本
              </Badge>
            </div>
            <CardDescription className="text-xs mt-1">{m.goal}</CardDescription>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Sections */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Target className="h-3 w-3" />
              章节内容
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {m.sections.map((s) => {
                const navTarget = NAV_MAP[s.id]
                return (
                  <div
                    key={s.id}
                    className="rounded-md border border-border/60 p-2.5 hover:border-primary/40 transition-colors group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary font-mono">{s.id}</Badge>
                      <span className="text-xs font-medium flex-1">{s.title}</span>
                      {navTarget && navTarget !== 'methodology' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onNavigate(navTarget) }}
                          className="opacity-0 group-hover:opacity-100 text-primary hover:text-primary/80 transition-opacity"
                          title={`跳转到${navTarget}`}
                        >
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-relaxed">{s.summary}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Scripts */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <FileCode className="h-3 w-3" />
              Python 脚本索引
              <span className="text-[10px] text-muted-foreground/70 ml-1">（点击查看代码示例）</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {m.scripts.map((s) => (
                <ScriptCard key={s.name} name={s.name} desc={s.desc} code={s.code} />
              ))}
            </div>
          </div>

          {/* Deliverables */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <CheckSquare className="h-3 w-3" />
              模块交付清单
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {m.deliverables.map((d, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md p-1.5 hover:bg-muted/50 transition-colors">
                  <div className="flex h-4 w-4 items-center justify-center rounded border border-primary/40 text-primary text-[8px]">✓</div>
                  <span className="text-xs">{d}</span>
                </div>
              ))}
            </div>
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
      'rounded-md border p-2 bg-card transition-all',
      code ? 'cursor-pointer hover:border-primary/40' : 'border-border/60',
      expanded && 'md:col-span-2 lg:col-span-3 border-primary/40'
    )}
    onClick={() => code && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <FileCode className="h-3 w-3 text-primary shrink-0" />
        <code className="text-[11px] font-mono font-medium text-primary flex-1 truncate">{name}</code>
        {code && (
          <Badge variant="outline" className="text-[9px] py-0 px-1 shrink-0">
            <Code className="h-2 w-2 mr-0.5" />
            代码
          </Badge>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground">{desc}</div>

      {expanded && code && (
        <div className="mt-2 animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-muted-foreground">Python 代码示例</span>
            <button
              onClick={copy}
              className="flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              {copied ? (
                <><CheckCircle2 className="h-2.5 w-2.5" /> 已复制</>
              ) : (
                <><Copy className="h-2.5 w-2.5" /> 复制</>
              )}
            </button>
          </div>
          <pre className="rounded-md bg-muted/50 border border-border/40 p-2.5 text-[10px] font-mono overflow-x-auto whitespace-pre leading-relaxed">
            {code}
          </pre>
        </div>
      )}
    </div>
  )
}
