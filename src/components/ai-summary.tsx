'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, FileText, Lightbulb, HelpCircle, Network, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { toastAiError } from '@/lib/ai-error'
import { AiMarkdown } from '@/components/ai-markdown'
import { cn } from '@/lib/utils'
import { AiOutputActions } from '@/components/ai-output-actions'

interface Paper {
  id: string
  title: string
  authors: string
  venue: string
  year: number
  tags: string
  notes: string
  abstract?: string
}

type SummaryType = 'summary' | 'keypoints' | 'questions' | 'relation'

/* 单一强调色：四个类型按深浅梯度递进（--primary 深 → --primary/70 中 → --primary/45 浅 → --primary/25 更浅），
   原本用四种颜色区分导致非常花哨，与设计系统不符 */
const SUMMARY_TYPES: Array<{ type: SummaryType; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = [
  { type: 'summary', label: '快速摘要', desc: '研究问题+方法+贡献', icon: FileText },
  { type: 'keypoints', label: '关键要点', desc: '5 个关键点提取', icon: Sparkles },
  { type: 'questions', label: '思考问题', desc: '3 个深入问题', icon: HelpCircle },
  { type: 'relation', label: '研究关联', desc: '方向+方法+改进', icon: Network },
]

const COLOR_MAP: Record<SummaryType, { bg: string; text: string; border: string }> = {
  summary: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/30' },
  keypoints: { bg: 'bg-primary/[0.07]', text: 'text-primary/70', border: 'border-primary/25' },
  questions: { bg: 'bg-accent/60', text: 'text-accent-foreground', border: 'border-primary/20' },
  relation: { bg: 'bg-accent/40', text: 'text-accent-foreground/80', border: 'border-border' },
}

export function AISummary({ paper }: { paper: Paper }) {
  const [loading, setLoading] = useState<SummaryType | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [showPanel, setShowPanel] = useState(false)
  // 记住每一类结果这次是基于摘要原文还是仅凭元数据 —— 决定要不要提示"补摘要"
  const [basedOn, setBasedOn] = useState<Record<string, 'abstract' | 'metadata'>>({})

  const hasAbstract = Boolean(paper.abstract?.trim())

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
        if (data.basedOn) setBasedOn((prev) => ({ ...prev, [type]: data.basedOn }))
        toast.success(`${SUMMARY_TYPES.find((t) => t.type === type)?.label}已生成`)
      } else {
        toastAiError(data, '生成失败')
      }
    } catch (e) {
      toast.error('AI 生成失败: ' + (e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="rounded-sm border border-l-2 border-l-primary/60 border-primary/20 bg-accent/30 p-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            AI 论文助手
          </div>
          <div className="caption">基于方法论 §2.3.2 精读模板 · LLM 智能分析</div>
        </div>
        <Badge variant="outline" className="rounded-sm text-[11px] font-normal bg-primary/5">
          <Sparkles className="h-3 w-3 mr-0.5" aria-hidden="true" />
          AI
        </Badge>
      </div>

      {/* 原料状态提示：有摘要（可信）vs 无摘要（警示：推测结果） */}
      <div
        className={cn(
          'mb-3 rounded-sm border-l-2 px-2 py-1.5 text-[11px] leading-relaxed',
          hasAbstract
            ? 'border-l-primary/60 border-primary/25 bg-accent/40 text-foreground'
            : /* 无摘要是警示状态 ⇒ destructive */ 'border-l-destructive/70 border-destructive/30 bg-destructive/5 text-destructive'
        )}
      >
        {hasAbstract
          ? '✓ 已入库摘要原文 —— AI 将基于摘要作答'
          : '⚠ 这篇论文还没有摘要原文，AI 只能凭标题/作者/标签推测，结果会标注「推测」。建议在文献库补上摘要，或先在 Zotero 同步一次。'}
      </div>

      {/* 4 action buttons（分四档明度，不再是四种颜色） */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {SUMMARY_TYPES.map((t) => {
          const Icon = t.icon
          const c = COLOR_MAP[t.type]
          const isLoading = loading === t.type
          const hasResult = !!results[t.type]
          return (
            <button
              key={t.type}
              type="button"
              onClick={() => generate(t.type)}
              disabled={loading !== null}
              aria-busy={isLoading}
              className={cn(
                'flex flex-col items-center gap-1 rounded-sm border p-2 text-center transition-colors disabled:opacity-50',
                hasResult ? c.border : 'border-border hover:border-primary/40',
                hasResult && c.bg
              )}
            >
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-full', c.bg, c.text)} aria-hidden="true">
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </div>
              <div className={cn('text-[11px] font-medium', hasResult && c.text)}>{t.label}</div>
              <div className="caption">{t.desc}</div>
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
            const c = COLOR_MAP[t.type]
            return (
              <div key={t.type} className={cn('rounded-sm border border-l-2', c.border, c.bg)}>
                <div className="flex items-center justify-between p-2.5 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <t.icon className={cn('h-3 w-3', c.text)} aria-hidden="true" />
                    <span className={cn('text-[11px] font-medium', c.text)}>{t.label}</span>
                  </div>
                  <AiOutputActions
                    content={result}
                    noteTitle={`AI ${t.label} · ${paper.title}`}
                    paperId={paper.id}
                    draftTitle={`AI ${t.label}：${paper.title}`}
                    compact
                  />
                </div>
                <div className="px-2.5 pb-2.5">
                  {loading === t.type ? (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-2">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      AI 正在分析论文...
                    </div>
                  ) : result ? (
                    <>
                      <AiMarkdown content={result} size="compact" />
                      {basedOn[t.type] === 'metadata' && (
                        /* 推测结果 = 警示 */
                        <div className="mt-1.5 rounded-sm border-t border-destructive/20 bg-destructive/5 pt-1.5 text-[11px] text-destructive">
                          本次结果基于元数据推测（无摘要原文）—— 方法名与结论请以原文为准
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!showPanel && (
        <div className="text-center caption py-1">
          点击上方按钮，AI 将基于论文信息生成智能分析
        </div>
      )}
    </div>
  )
}
