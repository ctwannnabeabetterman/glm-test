'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Sparkles, Compass, BookOpen, Cpu, Loader2, CheckCircle2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { toastAiError } from '@/lib/ai-error'
import { useApi } from '@/lib/hooks'
import { useAppStore } from '@/lib/store'
import { AiMarkdown } from '@/components/ai-markdown'
import { cn } from '@/lib/utils'
import { AiOutputActions } from '@/components/ai-output-actions'

type RecommendType = 'directions' | 'papers' | 'methods'

interface RetrievedPaper {
  title: string
  authors: string
  year: number
  venue: string
  doi: string
  citations: number
  url: string
}

const RECOMMEND_TYPES: Array<{ type: RecommendType; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; color: string }> = [
  { type: 'directions', label: '研究方向', desc: '推荐 5 个相关方向', icon: Compass, color: 'emerald' },
  { type: 'papers', label: '相关论文', desc: '真实检索 + AI 排序', icon: BookOpen, color: 'amber' },
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
  const [sources, setSources] = useState<Record<string, string>>({})
  const [retrieved, setRetrieved] = useState<Record<string, RetrievedPaper[]>>({})
  const [showPanel, setShowPanel] = useState(false)
  const api = useApi()
  const setSection = useAppStore((s) => s.setSection)
  /** 正在导入（避免连点造成重复入库） */
  const [importing, setImporting] = useState(false)
  /**
   * 记录**被取消勾选**的条目（key = `类型:序号`），而不是记录「已选」的。
   * 这样默认全选不需要预先铺一遍状态 —— 新检索回来的结果也自然全选。
   */
  const [deselected, setDeselected] = useState<Record<string, boolean>>({})

  /**
   * 把检索结果直接入库。
   *
   * 为什么要做这个：这批条目来自 **Crossref 真实检索**（带真 DOI），
   * 字段与论文库需要的完全对得上，但此前 UI 只给一个 DOI 外链 ——
   * 用户等于拿着可用文献还要手动再录一遍。
   *
   * 走 `{ records }` 而不是拼 RIS：结构化来源直接给结构化数据，少一层
   * 「拼文本 → 再解析」的损耗（RIS 的换行/转义没处理干净会静默丢字段）。
   * 去重由服务端的 `mergeBibliography` 负责（按 DOI / zoteroKey / 标题）。
   */
  const importRetrieved = async (type: RecommendType) => {
    const list = retrieved[type] || []
    const picked = list.filter((_, i) => !deselected[`${type}:${i}`])
    if (picked.length === 0) {
      toast.error('请至少勾选一篇')
      return
    }
    setImporting(true)
    try {
      const res = await api.post('/api/papers/import', { records: picked })
      // ⚠️ 措辞要跟 `mergeBibliography` 的真实语义一致：
      //   · created = 新增
      //   · updated = **命中已有条目**（按 DOI / zoteroKey / 标题去重后合并元数据）—— 不是「跳过」
      //   · skipped 只统计「没有标题、被丢弃」的记录，与「已存在」无关
      // 之前把 updated 说成跳过、把 skipped 说成「已存在」，两个都说反了。
      const parts = [
        `新增 ${res.created ?? 0} 篇`,
        res.updated ? `合并已有 ${res.updated} 篇` : '',
        res.skipped ? `丢弃 ${res.skipped} 条无标题记录` : '',
      ].filter(Boolean)
      toast.success(`导入完成：${parts.join('，')}`, {
        action: { label: '去论文库', onClick: () => setSection('papers') },
      })
    } catch (e) {
      toast.error('导入失败：' + (e as Error).message)
    } finally {
      setImporting(false)
    }
  }

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
        if (data.source) setSources((prev) => ({ ...prev, [type]: data.source }))
        if (Array.isArray(data.retrieved)) setRetrieved((prev) => ({ ...prev, [type]: data.retrieved }))
        toast.success(`${RECOMMEND_TYPES.find((t) => t.type === type)?.label}已生成`)
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
                    <AiOutputActions
                      content={result}
                      noteTitle={`AI ${t.label} · ${topic}`}
                      draftTitle={`${t.label}：${topic}`}
                      compact
                    />
                  </div>
                  {loading === t.type ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t.type === 'papers' ? '正在检索文献数据库…' : 'AI 正在分析并生成推荐...'}
                    </div>
                  ) : result ? (
                    <>
                      <AiMarkdown content={result} size="default" />

                      {/* 论文推荐：如实标注来源，并把真实检索结果列出来供逐条核实 */}
                      {t.type === 'papers' && (
                        <div className="mt-2 border-t border-amber-500/20 pt-2">
                          {sources[t.type] === 'crossref' ? (
                            <>
                              <div className="flex items-center gap-1 text-[10px] text-emerald-600">
                                <CheckCircle2 className="h-3 w-3" />
                                已通过 Crossref 真实检索 —— 下列 DOI 可直接点击核实
                              </div>
                              {/* DOI 链接刻意放在 <label> 之外：label 内的点击会连带触发勾选，
                                  那样用户「点开核实」会顺手把这条取消掉。 */}
                              <div className="mt-1.5 space-y-1">
                                {(retrieved[t.type] || []).map((p, i) => {
                                  const key = `${t.type}:${i}`
                                  const checked = !deselected[key]
                                  return (
                                    <div
                                      key={`${p.doi || p.title}-${i}`}
                                      className="flex items-start gap-1.5 px-1 py-0.5 text-[10px] leading-snug"
                                    >
                                      <label className={cn('flex min-w-0 flex-1 cursor-pointer items-start gap-1.5', !checked && 'opacity-50')}>
                                        <Checkbox
                                          checked={checked}
                                          onCheckedChange={() => setDeselected((prev) => ({ ...prev, [key]: !prev[key] }))}
                                          className="mt-0.5 h-3 w-3 shrink-0"
                                        />
                                        <span className="min-w-0 text-muted-foreground">
                                          <span className="font-medium">[{i + 1}]</span> {p.title}
                                          {p.year ? ` (${p.year})` : ''}
                                          {p.venue ? ` · ${p.venue}` : ''}
                                        </span>
                                      </label>
                                      <a
                                        href={p.url || `https://doi.org/${p.doi}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="shrink-0 text-blue-600 hover:underline"
                                      >
                                        {p.doi || '打开'}
                                      </a>
                                    </div>
                                  )
                                })}
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                {(() => {
                                  const list = retrieved[t.type] || []
                                  const pickedCount = list.filter((_, i) => !deselected[`${t.type}:${i}`]).length
                                  return (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-[10px]"
                                      disabled={importing || pickedCount === 0}
                                      onClick={() => void importRetrieved(t.type)}
                                    >
                                      {importing ? (
                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      ) : (
                                        <Download className="mr-1 h-3 w-3" />
                                      )}
                                      导入论文库（已选 {pickedCount} 篇）
                                    </Button>
                                  )
                                })()}
                                <span className="text-[10px] text-muted-foreground">按 DOI / 标题自动去重</span>
                              </div>
                            </>
                          ) : (
                            <div className="text-[10px] text-amber-600">
                              本次未能连接 Crossref（网络不可达或超时），结果基于模型知识 ——
                              标题、作者、年份请务必自行核实后再引用。
                            </div>
                          )}
                        </div>
                      )}
                    </>
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
