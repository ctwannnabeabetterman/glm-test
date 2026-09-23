'use client'

import { useMemo, useState } from 'react'
import { useFetch } from '@/lib/hooks'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sparkles, Lightbulb, Search, FileText, Loader2, CheckCircle2, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { toastAiError } from '@/lib/ai-error'
import { AiMarkdown } from '@/components/ai-markdown'
import { cn } from '@/lib/utils'
import { AiOutputActions } from '@/components/ai-output-actions'

type AnalysisType = 'gaps' | 'opportunities' | 'literature'

const ANALYSIS_TYPES: Array<{ type: AnalysisType; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; color: string }> = [
  { type: 'gaps', label: '研究空白分析', desc: '识别 Research Gaps', icon: Search, color: 'red' },
  { type: 'opportunities', label: '研究机会', desc: '发现创新点', icon: Lightbulb, color: 'amber' },
  { type: 'literature', label: '综述框架', desc: '生成文献综述大纲', icon: FileText, color: 'blue' },
]

const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  red: { bg: 'bg-red-500/10', text: 'text-red-600', border: 'border-red-500/30' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/30' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-500/30' },
}

/** 「全库综合分析」的哨兵值 —— Radix Select 不允许空字符串作为 item value */
const ALL_TOPICS = '__all__'

interface TopicOption {
  id: string
  name: string
  direction: string
}

interface AnalysisUsed {
  papers: number
  notes: number
  relatedPapers: number
  unlinkedPapers: number
}

interface AnalysisResult {
  content: string
  topicName: string | null
  used: AnalysisUsed
}

/**
 * AI 研究分析面板。
 *
 * 2026-09-18 用户反馈：要加课题选择 —— 原来是对全库做分析，
 * 「多个同时分析内容少不说，还容易在课题多了以后互相干扰」。
 * 现在顶部有一个课题下拉：选中某个课题后，分析只基于**该课题域**的论文与笔记，
 * 结果按「课题 + 分析类型」分别缓存（切回来还能看到，不会串）。
 */
export function AIGapAnalysis() {
  const { data: topics } = useFetch<TopicOption[]>('/api/topics')
  // '' 表示「用户还没选」—— 此时由下面派生默认值补上，而不是在 effect 里 setState
  // （在 effect 里同步 setState 会触发级联渲染，eslint 也不允许）。
  const [picked, setPicked] = useState<string>('')
  const [loading, setLoading] = useState<AnalysisType | null>(null)
  // 结果按 `${topicId}:${type}` 存 —— 不加课题维度的话，切课题后旧结果会
  // 显示成新课题的结论（这是比"没结果"更坏的一种错）。
  const [results, setResults] = useState<Record<string, AnalysisResult>>({})
  const [showPanel, setShowPanel] = useState(false)

  const topicList = useMemo(() => topics ?? [], [topics])

  /**
   * 默认选中第一个课题（用户的诉求就是「按课题分析」，不必每次手点）。
   *
   * 用**派生**而不是 useEffect：课题列表是异步来的，用 effect 同步 setState
   * 会级联渲染；而「没选就看第一个」本来就是个纯计算。
   * 用户一旦动过下拉（picked 非空）就完全听他的。
   */
  const topicId = picked || (topicList.length > 0 ? topicList[0].id : ALL_TOPICS)

  const currentTopic = topicList.find((t) => t.id === topicId) ?? null
  const scopeLabel = topicId === ALL_TOPICS ? '全库综合分析' : currentTopic?.name ?? '（课题加载中）'

  const generate = async (type: AnalysisType) => {
    setLoading(type)
    setShowPanel(true)
    const key = `${topicId}:${type}`
    try {
      const res = await fetch('/api/ai-gap-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, topicId: topicId === ALL_TOPICS ? '' : topicId }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        toastAiError(data, '生成失败')
        return
      }
      setResults((prev) => ({
        ...prev,
        [key]: { content: data.content, topicName: data.topicName ?? null, used: data.used },
      }))
      const used = data.used as AnalysisUsed | undefined
      toast.success(
        `${ANALYSIS_TYPES.find((t) => t.type === type)?.label}已生成` +
          (used ? `（依据 ${used.papers} 篇论文、${used.notes} 条笔记）` : '')
      )
    } catch (e) {
      toast.error('AI 生成失败: ' + (e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI 研究分析
            </CardTitle>
            <CardDescription className="text-xs">
              按课题分析 · 只使用该课题的论文与笔记，避免多课题互相干扰
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[9px] bg-primary/5">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            LLM
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 课题域选择 */}
        <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            <Layers className="h-3.5 w-3.5 text-primary" />
            分析范围
          </div>
          <Select value={topicId} onValueChange={setPicked}>
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="选择课题" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TOPICS}>全库综合分析（不限课题）</SelectItem>
              {topicList.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  {t.direction ? `（${t.direction}）` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {topicId === ALL_TOPICS
              ? '当前不限课题 —— 全库数据混在一起，课题多时结论容易被稀释。建议选一个具体课题。'
              : `本次只使用挂到「${scopeLabel}」的论文与笔记；未归课题的论文不会被算进来。想让文献进来，请到文献库给它挂上这个课题。`}
          </p>
        </div>

        {/* 3 action buttons */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {ANALYSIS_TYPES.map((t) => {
            const Icon = t.icon
            const c = COLOR_MAP[t.color]
            const isLoading = loading === t.type
            const hasResult = !!results[`${topicId}:${t.type}`]
            return (
              <button
                key={t.type}
                onClick={() => generate(t.type)}
                disabled={loading !== null}
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
                {hasResult && (
                  <CheckCircle2 className={cn('h-3 w-3', c.text)} />
                )}
              </button>
            )
          })}
        </div>

        {/* Results panel */}
        {showPanel && (
          <div className="space-y-2 animate-fade-in">
            {ANALYSIS_TYPES.map((t) => {
              const result = results[`${topicId}:${t.type}`]
              if (!result && loading !== t.type) return null
              const c = COLOR_MAP[t.color]
              return (
                <div key={t.type} className={cn('rounded-md border p-3', c.border, c.bg)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <t.icon className={cn('h-3.5 w-3.5', c.text)} />
                      <span className={cn('text-xs font-medium', c.text)}>{t.label}</span>
                      {result && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-normal">
                          {result.topicName ?? '全库'}
                          {' · '}
                          {result.used.papers} 篇 / {result.used.notes} 条
                        </Badge>
                      )}
                    </div>
                    <AiOutputActions
                      content={result.content}
                      noteTitle={`AI ${t.label} · ${result.topicName ?? '全库'}`}
                      draftTitle={`${t.label}：${result.topicName ?? '全库'}`}
                      compact
                    />
                  </div>
                  {loading === t.type ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在分析「{scopeLabel}」的科研数据，请稍候...
                    </div>
                  ) : result ? (
                    <AiMarkdown content={result.content} size="default" />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {!showPanel && (
          <div className="text-center text-[11px] text-muted-foreground py-2">
            选好课题后点击上方按钮，AI 将只基于该课题的论文与笔记生成分析
          </div>
        )}
      </CardContent>
    </Card>
  )
}
