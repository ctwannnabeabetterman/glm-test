'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Sparkles, FlaskConical, Layers, Scissors, CheckSquare, Copy, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type AdvisorType = 'design' | 'baselines' | 'ablation' | 'checklist'

const ADVISOR_TYPES: Array<{ type: AdvisorType; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; color: string }> = [
  { type: 'design', label: '实验设计', desc: '完整实验方案', icon: FlaskConical, color: 'emerald' },
  { type: 'baselines', label: '基线推荐', desc: '3-5 个基线方法', icon: Layers, color: 'amber' },
  { type: 'ablation', label: '消融设计', desc: '消融组件+表格', icon: Scissors, color: 'purple' },
  { type: 'checklist', label: '完整性检查', desc: '实验检查清单', icon: CheckSquare, color: 'blue' },
]

const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/30' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/30' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-600', border: 'border-purple-500/30' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-500/30' },
}

export function AIExperimentAdvisor() {
  const [loading, setLoading] = useState<AdvisorType | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [showPanel, setShowPanel] = useState(false)
  const [topic, setTopic] = useState('')
  const [method, setMethod] = useState('')

  const generate = async (type: AdvisorType) => {
    if (!topic.trim() && !method.trim()) {
      toast.error('请输入研究课题或方法')
      return
    }
    setLoading(type)
    setShowPanel(true)
    try {
      const res = await fetch('/api/ai-experiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, method, type }),
      })
      const data = await res.json()
      if (data.success) {
        setResults((prev) => ({ ...prev, [type]: data.content }))
        toast.success(`${ADVISOR_TYPES.find((t) => t.type === type)?.label}已生成`)
      } else {
        toast.error(data.error || '生成失败')
      }
    } catch (e) {
      toast.error('AI 生成失败: ' + (e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('已复制到剪贴板')
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI 实验设计顾问
            </CardTitle>
            <CardDescription className="text-xs">
              基于研究课题 · AI 生成实验方案、基线、消融、检查清单
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[9px] bg-primary/5">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            LLM
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Input */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">研究课题</Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="RIS 辅助 DRL 资源分配"
              className="mt-1 text-xs h-8"
            />
          </div>
          <div>
            <Label className="text-xs">使用方法</Label>
            <Input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="多智能体 DRL + Attention"
              className="mt-1 text-xs h-8"
            />
          </div>
        </div>

        {/* 4 action buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {ADVISOR_TYPES.map((t) => {
            const Icon = t.icon
            const c = COLOR_MAP[t.color]
            const isLoading = loading === t.type
            const hasResult = !!results[t.type]
            return (
              <button
                key={t.type}
                onClick={() => generate(t.type)}
                disabled={loading !== null}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border p-2.5 text-center transition-all disabled:opacity-50',
                  hasResult ? c.border : 'border-border hover:border-primary/40',
                  hasResult && c.bg
                )}
              >
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-full', c.bg, c.text)}>
                  {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                </div>
                <div className={cn('text-[11px] font-medium', hasResult && c.text)}>{t.label}</div>
                <div className="text-[9px] text-muted-foreground leading-tight">{t.desc}</div>
                {hasResult && <CheckCircle2 className={cn('h-2.5 w-2.5', c.text)} />}
              </button>
            )
          })}
        </div>

        {/* Results panel */}
        {showPanel && (
          <div className="space-y-2 animate-fade-in">
            {ADVISOR_TYPES.map((t) => {
              const result = results[t.type]
              if (!result && loading !== t.type) return null
              const c = COLOR_MAP[t.color]
              return (
                <div key={t.type} className={cn('rounded-md border p-3', c.border, c.bg)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <t.icon className={cn('h-3.5 w-3.5', c.text)} />
                      <span className={cn('text-xs font-medium', c.text)}>{t.label}</span>
                    </div>
                    {result && (
                      <button
                        onClick={() => copy(result)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-2.5 w-2.5" /> 复制
                      </button>
                    )}
                  </div>
                  {loading === t.type ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      AI 正在生成{t.label}...
                    </div>
                  ) : result ? (
                    <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono max-h-[500px] overflow-y-auto">
                      {result}
                    </pre>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {!showPanel && (
          <div className="text-center text-[10px] text-muted-foreground py-1">
            💡 方法论 §3.1-3.4 实验设计方法论 · AI 辅助生成完整实验方案
          </div>
        )}
      </CardContent>
    </Card>
  )
}
