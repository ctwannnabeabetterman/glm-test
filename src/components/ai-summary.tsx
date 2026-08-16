'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, FileText, Lightbulb, HelpCircle, Network, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Paper {
  id: string
  title: string
  authors: string
  venue: string
  year: number
  tags: string
  notes: string
}

type SummaryType = 'summary' | 'keypoints' | 'questions' | 'relation'

const SUMMARY_TYPES: Array<{ type: SummaryType; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; color: string }> = [
  { type: 'summary', label: '快速摘要', desc: '研究问题+方法+贡献', icon: FileText, color: 'emerald' },
  { type: 'keypoints', label: '关键要点', desc: '5 个关键点提取', icon: Sparkles, color: 'amber' },
  { type: 'questions', label: '思考问题', desc: '3 个深入问题', icon: HelpCircle, color: 'blue' },
  { type: 'relation', label: '研究关联', desc: '方向+方法+改进', icon: Network, color: 'purple' },
]

const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/30' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/30' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-500/30' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-600', border: 'border-purple-500/30' },
}

export function AISummary({ paper }: { paper: Paper }) {
  const [loading, setLoading] = useState<SummaryType | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [showPanel, setShowPanel] = useState(false)

  const generate = async (type: SummaryType) => {
    setLoading(type)
    setShowPanel(true)
    try {
      const res = await fetch('/api/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperId: paper.id, type }),
      })
      const data = await res.json()
      if (data.success) {
        setResults((prev) => ({ ...prev, [type]: data.content }))
        toast.success(`${SUMMARY_TYPES.find((t) => t.type === type)?.label}已生成`)
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
    <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI 论文助手
          </div>
          <div className="text-[10px] text-muted-foreground">基于方法论 §2.3.2 精读模板 · LLM 智能分析</div>
        </div>
        <Badge variant="outline" className="text-[9px] bg-primary/5">
          <Sparkles className="h-2.5 w-2.5 mr-0.5" />
          AI
        </Badge>
      </div>

      {/* 4 action buttons */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {SUMMARY_TYPES.map((t) => {
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
                'flex flex-col items-center gap-1 rounded-md border p-2 text-center transition-all disabled:opacity-50',
                hasResult ? c.border : 'border-border hover:border-primary/40',
                hasResult && c.bg
              )}
            >
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-full', c.bg, c.text)}>
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </div>
              <div className={cn('text-[10px] font-medium', hasResult && c.text)}>{t.label}</div>
              <div className="text-[9px] text-muted-foreground leading-tight">{t.desc}</div>
            </button>
          )
        })}
      </div>

      {/* Results panel */}
      {showPanel && (
        <div className="space-y-2 animate-fade-in">
          {SUMMARY_TYPES.map((t) => {
            const result = results[t.type]
            if (!result && loading !== t.type) return null
            const c = COLOR_MAP[t.color]
            return (
              <div key={t.type} className={cn('rounded-md border p-2.5', c.border, c.bg)}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <t.icon className={cn('h-3 w-3', c.text)} />
                    <span className={cn('text-[11px] font-medium', c.text)}>{t.label}</span>
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
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    AI 正在分析论文...
                  </div>
                ) : result ? (
                  <div className="text-[11px] leading-relaxed whitespace-pre-wrap">{result}</div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {!showPanel && (
        <div className="text-center text-[10px] text-muted-foreground py-1">
          点击上方按钮，AI 将基于论文信息生成智能分析
        </div>
      )}
    </div>
  )
}
