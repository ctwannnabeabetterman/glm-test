'use client'

import { useMemo, useState } from 'react'
import { useFetch } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sparkles, Loader2, TriangleAlert, Check, Layers, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { toastAiError } from '@/lib/ai-error'
import { cn } from '@/lib/utils'
import {
  PRIORITY_LABEL,
  diffSuggestion,
  type PaperPriority,
  type ScoreSuggestion,
} from '@/lib/library/reading-priority'

/** 「不限课题」哨兵 —— Radix Select 不接受空字符串作为 item value */
const ALL_TOPICS = '__all__'

const SCOPES = [
  { id: 'unread', label: '仅未读', hint: '把该不该读的顺序排一遍 —— 最常用' },
  { id: 'all', label: '全部论文', hint: '连同已读的一起重评，适合换了课题之后' },
  { id: 'reading', label: '仅在读', hint: '手上正在读的这几篇值不值得继续' },
  { id: 'read', label: '仅已读', hint: '复盘：读过的这批到底有多相关' },
] as const

type ScoreScope = (typeof SCOPES)[number]['id']

interface TopicOption {
  id: string
  name: string
  direction: string
}

/** 打分要用到的最小论文形状（与论文列表的 Paper 字段对齐） */
export interface ScorableRow {
  id: string
  title: string
  year: number
  codeUrl: string
  relevance: number
  novelty: number
  priority: string
}

interface ScoreResponse {
  success?: boolean
  suggestions?: ScoreSuggestion[]
  unknownIds?: string[]
  malformed?: number
  used?: { papers: number; scopeLabel: string; topicName: string | null }
  error?: string
  code?: string
}

/** `used` 在响应里是可选的，所以本地状态要自己补上 null（而不是 undefined）这一档 */
type UsedInfo = NonNullable<ScoreResponse['used']>

/**
 * 「AI 重评阅读优先级」面板。
 *
 * 它替换的是一种很常见的隐性衰退：论文建库时按直觉填一遍相关度/新颖度/优先级，
 * 之后**再没人回头改**，于是那张「阅读优先级榜」很快就不再反映真实优先级 ——
 * 而它恰恰是决定「今天读哪篇」的那个榜。
 *
 * 交互上刻意分成两步（生成建议 → 勾选应用），不是「一键全改」：
 * 模型的分数有可能整体偏高，批量静默覆盖掉用户自己填过的判断，比不做更糟。
 * 所以这里把每一条的「当前 → 建议」和理由都摆出来，由人来拍板。
 */
export function PaperScorePanel({ papers, onApplied }: { papers: ScorableRow[]; onApplied: () => void }) {
  const { data: topics } = useFetch<TopicOption[]>('/api/topics')
  const [picked, setPicked] = useState('')
  const [scope, setScope] = useState<ScoreScope>('unread')
  const [limit, setLimit] = useState(20)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [suggestions, setSuggestions] = useState<ScoreSuggestion[] | null>(null)
  const [unknownIds, setUnknownIds] = useState<string[]>([])
  const [used, setUsed] = useState<UsedInfo | null>(null)
  /** 被取消勾选的 id（默认全选：多数时候用户是想全部采纳的） */
  const [deselected, setDeselected] = useState<Set<string>>(new Set())

  const topicList = useMemo(() => topics ?? [], [topics])
  const topicId = picked || (topicList.length > 0 ? topicList[0].id : ALL_TOPICS)
  const byId = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers])

  const rows = useMemo(() => {
    if (!suggestions) return []
    return suggestions.map((s) => {
      const before = byId.get(s.id) ?? {
        id: s.id, title: s.id, year: 0, codeUrl: '', relevance: 0, novelty: 0, priority: 'medium',
      }
      return { suggestion: s, before, diff: diffSuggestion(before, s) }
    })
  }, [suggestions, byId])

  const selected = useMemo(
    () => rows.filter((r) => !deselected.has(r.suggestion.id)),
    [rows, deselected],
  )

  const generate = async () => {
    setLoading(true)
    setSuggestions(null)
    setUnknownIds([])
    setDeselected(new Set())
    try {
      const res = await fetch('/api/ai-paper-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicId: topicId === ALL_TOPICS ? '' : topicId,
          scope,
          limit,
        }),
      })
      const data = (await res.json()) as ScoreResponse
      if (!res.ok || !data.success) {
        toastAiError(data, 'AI 打分失败')
        return
      }
      setSuggestions(data.suggestions ?? [])
      setUnknownIds(data.unknownIds ?? [])
      setUsed(data.used ?? null)
      const n = data.suggestions?.length ?? 0
      toast.success(
        n > 0 ? `AI 给出了 ${n} 条评分建议，确认后写回` : 'AI 没有给出可用的建议（输出可能不是 JSON）',
      )
    } catch (e) {
      toast.error('AI 打分失败: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (selected.length === 0) {
      toast.error('没有勾选任何条目')
      return
    }
    setApplying(true)
    try {
      const res = await fetch('/api/papers/apply-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selected.map((r) => ({
            id: r.suggestion.id,
            relevance: r.suggestion.relevance,
            novelty: r.suggestion.novelty,
            priority: r.suggestion.priority,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data?.error || 'apply failed')
      toast.success(
        `已写回 ${data.applied} 篇（这些分数会标记为「AI 给的」，你手工改过就会自动摘掉）` +
          (data.missing?.length ? ` · ${data.missing.length} 篇已不存在，已跳过` : ''),
      )
      setSuggestions(null)
      setUsed(null)
      onApplied()
    } catch (e) {
      toast.error('写回失败: ' + (e as Error).message)
    } finally {
      setApplying(false)
    }
  }

  const toggle = (id: string) => {
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Card className="bg-primary/[0.03] border-primary/20">
      <CardContent className="p-3 space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI 重评阅读优先级
          <span className="ml-auto text-[10px] text-muted-foreground font-normal">
            打分依据 = 题录 + 摘要（不含正文）
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">课题域（相关度的参照系）</Label>
            <Select value={topicId} onValueChange={setPicked}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue placeholder="选择课题" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TOPICS}>不限课题（按领域一般价值）</SelectItem>
                {topicList.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.direction ? `（${t.direction}）` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">重评范围</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as ScoreScope)}>
              <SelectTrigger className="h-8 text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">最多评几篇</Label>
            <input
              type="number"
              min={1}
              max={40}
              value={limit}
              onChange={(e) => setLimit(Math.min(40, Math.max(1, Number(e.target.value) || 1)))}
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs tabular-nums"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={generate} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> 打分中（约 30 秒）...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> 让 AI 打分
              </>
            )}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {SCOPES.find((s) => s.id === scope)?.hint}
          </span>
        </div>

        {suggestions !== null && (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-2">
            {rows.length === 0 ? (
              <p className="text-[11px] text-muted-foreground py-2 text-center">
                这一批没有可用的建议（模型没按 JSON 输出，或全部条目都不在清单里）。可以再点一次。
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium">
                    建议 {rows.length} 条
                    {used ? `（依据 ${used.papers} 篇 · ${used.scopeLabel}）` : ''}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDeselected(new Set())}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeselected(new Set(rows.map((r) => r.suggestion.id)))}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      全不选
                    </button>
                  </div>
                </div>

                {unknownIds.length > 0 && (
                  <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px]">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
                    <span>
                      模型给出了 {unknownIds.length} 个不在本批清单里的 id，已忽略：{unknownIds.slice(0, 3).join('、')}
                      {unknownIds.length > 3 ? ' 等' : ''}
                    </span>
                  </div>
                )}

                <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
                  {rows.map(({ suggestion, before, diff }) => {
                    const on = !deselected.has(suggestion.id)
                    return (
                      <div
                        key={suggestion.id}
                        className={cn(
                          'flex items-start gap-2 rounded-md border p-2 transition-colors',
                          on ? 'border-primary/30 bg-primary/5' : 'border-border/50 opacity-60',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(suggestion.id)}
                          aria-label={`应用对「${before.title}」的评分`}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="text-[11px] font-medium leading-snug line-clamp-2">{before.title}</div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                            {diff.changes.length === 0 ? (
                              <span className="text-muted-foreground">与当前评分一致</span>
                            ) : (
                              diff.changes.map((c) => (
                                <Badge key={c} variant="secondary" className="text-[10px] py-0">
                                  {c}
                                </Badge>
                              ))
                            )}
                            {diff.changed && (
                              <span className="text-muted-foreground">
                                排序分数 {diff.scoreDelta > 0 ? '+' : ''}
                                {diff.scoreDelta.toFixed(1)}
                              </span>
                            )}
                            <span className="ml-auto text-muted-foreground">
                              建议优先级 {PRIORITY_LABEL[suggestion.priority as PaperPriority] ?? suggestion.priority}
                            </span>
                          </div>
                          {suggestion.reason && (
                            <div className="text-[10px] text-muted-foreground leading-relaxed">
                              {suggestion.reason}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                  <Button size="sm" onClick={apply} disabled={applying || selected.length === 0}>
                    {applying ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> 写回中...
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1.5" /> 应用选中的 {selected.length} 篇
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setSuggestions(null)
                      setUnknownIds([])
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    全部忽略
                  </button>
                  <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                    <ArrowRight className="h-2.5 w-2.5" />
                    写回后会标记为「AI 给的」，你手工改过分数就自动摘掉标记
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {papers.length === 0 && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Layers className="h-3 w-3" />
            论文库还是空的，先导入文献再回来打分。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
