'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Sparkles, Compass, BookOpen, Cpu, Copy, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type RecommendType = 'directions' | 'papers' | 'methods'

const RECOMMEND_TYPES: Array<{ type: RecommendType; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; color: string }> = [
  { type: 'directions', label: '研究方向', desc: '推荐 5 个相关方向', icon: Compass, color: 'emerald' },
  { type: 'papers', label: '相关论文', desc: '推荐 5 篇应读论文', icon: BookOpen, color: 'amber' },
  { type: 'methods', label: 'AI 方法', desc: '推荐 5 种技术方法', icon: Cpu, color: 'purple' },
]

const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/30' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/30' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-600', border: 'border-purple-500/30' },
}

export function AIRelatedPapers() {
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState<RecommendType | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [showPanel, setShowPanel] = useState(false)

  const generate = async (type: RecommendType) => {
    if (!topic.trim()) {
      toast.error('请先输入研究课题或关键词')
      return
    }
    setLoading(type)
    setShowPanel(true)
    try {
      const res = await fetch('/api/ai-related-papers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, type }),
      })
      const data = await res.json()
      if (data.success) {
        setResults((prev) => ({ ...prev, [type]: data.content }))
        toast.success(`${RECOMMEND_TYPES.find((t) => t.type === type)?.label}已生成`)
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
              AI 相关推荐
            </CardTitle>
            <CardDescription className="text-xs">
              输入研究课题 · AI 推荐相关方向、论文、方法
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[9px] bg-primary/5">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            LLM
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Topic input */}
        <div>
          <Label className="text-xs">研究课题 / 关键词 *</Label>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例如: RIS 辅助的 DRL 资源分配"
            className="mt-1 text-xs"
          />
        </div>

        {/* 3 action buttons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {RECOMMEND_TYPES.map((t) => {
            const Icon = t.icon
            const c = COLOR_MAP[t.color]
            const isLoading = loading === t.type
            const hasResult = !!results[t.type]
            return (
              <button
                key={t.type}
                onClick={() => generate(t.type)}
                disabled={loading !== null || !topic.trim()}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-all disabled:opacity-50',
                  hasResult ? c.border : 'border-border hover:border-primary/40',
                  hasResult && c.bg
                )}
              >
                <div className={cn('flex h-9 w-9 items-center justify-center rounded-full', c.bg, c.text)}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <div className={cn('text-xs font-medium', hasResult && c.text)}>{t.label}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">{t.desc}</div>
                {hasResult && <CheckCircle2 className={cn('h-3 w-3', c.text)} />}
              </button>
            )
          })}
        </div>

        {/* Results panel */}
        {showPanel && (
          <div className="space-y-2 animate-fade-in">
            {RECOMMEND_TYPES.map((t) => {
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
                      AI 正在分析并生成推荐...
                    </div>
                  ) : result ? (
                    <div className="text-xs leading-relaxed whitespace-pre-wrap font-mono">
                      {result}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {!showPanel && (
          <div className="text-center text-[11px] text-muted-foreground py-2">
            输入研究课题后，AI 将推荐相关方向、论文和方法
          </div>
        )}
      </CardContent>
    </Card>
  )
}
