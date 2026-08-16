'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState, useMemo } from 'react'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GitBranch, Trash2, Plus, ArrowRight, TrendingUp, Award } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Paper {
  id: string
  title: string
  authors: string
  venue: string
  year: number
}

interface Citation {
  id: string
  citingPaperId: string
  citedPaperId: string
  context: string
  createdAt: string
  citingPaper: Paper
  citedPaper: Paper
}

interface CitationData {
  citations: Citation[]
  stats: { totalCitations: number; papersWithCitations: number }
  topCited: Array<Paper & { citedByCount: number; citesCount: number }>
}

export function CitationTracker() {
  const { data, loading, refetch } = useFetch<CitationData>('/api/citations')
  const { data: papers } = useFetch<Paper[]>('/api/papers')
  const api = useApi()
  const [showAdd, setShowAdd] = useState(false)
  const [citingId, setCitingId] = useState('')
  const [citedId, setCitedId] = useState('')
  const [context, setContext] = useState('')

  const handleAdd = async () => {
    if (!citingId || !citedId) {
      toast.error('请选择两篇论文')
      return
    }
    if (citingId === citedId) {
      toast.error('不能引用自己')
      return
    }
    try {
      await api.post('/api/citations', { citingPaperId: citingId, citedPaperId: citedId, context })
      toast.success('引用关系已添加')
      setShowAdd(false)
      setCitingId('')
      setCitedId('')
      setContext('')
      refetch()
    } catch {
      toast.error('添加失败')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.del(`/api/citations?id=${id}`)
      toast.success('已删除')
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  if (loading) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">加载引用数据...</CardContent></Card>
  }

  const citations = data?.citations || []
  const topCited = data?.topCited || []

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-border/60 bg-card p-2 text-center">
          <div className="text-lg font-bold text-primary">{data?.stats.totalCitations ?? 0}</div>
          <div className="text-[10px] text-muted-foreground">引用关系</div>
        </div>
        <div className="rounded-md border border-border/60 bg-card p-2 text-center">
          <div className="text-lg font-bold text-emerald-600">{data?.stats.papersWithCitations ?? 0}</div>
          <div className="text-[10px] text-muted-foreground">有引用论文</div>
        </div>
        <div className="rounded-md border border-border/60 bg-card p-2 text-center">
          <div className="text-lg font-bold text-amber-600">{papers?.length ?? 0}</div>
          <div className="text-[10px] text-muted-foreground">总论文数</div>
        </div>
      </div>

      {/* Add citation button */}
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => setShowAdd(!showAdd)}
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        {showAdd ? '取消添加' : '添加引用关系'}
      </Button>

      {/* Add form */}
      {showAdd && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <div>
              <label className="text-[10px] text-muted-foreground">引用方（这篇引用了其他论文）</label>
              <Select value={citingId} onValueChange={setCitingId}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="选择论文..." /></SelectTrigger>
                <SelectContent>
                  {papers?.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.title.length > 50 ? p.title.slice(0, 48) + '..' : p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-center">
              <ArrowRight className="h-4 w-4 text-primary rotate-90" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">被引方（这篇被其他论文引用）</label>
              <Select value={citedId} onValueChange={setCitedId}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="选择论文..." /></SelectTrigger>
                <SelectContent>
                  {papers?.filter((p) => p.id !== citingId).map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.title.length > 50 ? p.title.slice(0, 48) + '..' : p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">引用上下文（可选）</label>
              <input
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="例如: Section II.C 中对比了该方法"
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs mt-0.5"
              />
            </div>
            <Button size="sm" className="w-full" onClick={handleAdd} disabled={!citingId || !citedId}>
              确认添加
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Top cited papers */}
      {topCited.length > 0 && (
        <div>
          <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Award className="h-3 w-3 text-amber-500" />
            引用排行 Top {topCited.length}
          </div>
          <div className="space-y-1.5">
            {topCited.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 rounded-md border border-border/40 p-2">
                <div className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                  i === 0 ? 'bg-amber-500 text-white' : i === 1 ? 'bg-slate-400 text-white' : i === 2 ? 'bg-orange-700 text-white' : 'bg-muted text-muted-foreground'
                )}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{p.title}</div>
                  <div className="text-[9px] text-muted-foreground truncate">{p.authors} · {p.year}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Badge variant="secondary" className="text-[9px] bg-emerald-500/10 text-emerald-600">
                    被引 {p.citedByCount}
                  </Badge>
                  <Badge variant="secondary" className="text-[9px] bg-blue-500/10 text-blue-600">
                    引用 {p.citesCount}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Citations list */}
      <div>
        <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-primary" />
          引用关系列表 ({citations.length})
        </div>
        {citations.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center text-xs text-muted-foreground">
              <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-30" />
              暂无引用关系，点击上方按钮添加
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {citations.map((c) => (
              <div key={c.id} className="rounded-md border border-border/60 p-2 group">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-muted-foreground shrink-0">引用方:</span>
                      <span className="text-[10px] font-medium truncate">{c.citingPaper?.title}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ArrowRight className="h-2.5 w-2.5 text-primary rotate-90 shrink-0" />
                      <span className="text-[9px] text-muted-foreground shrink-0">被引方:</span>
                      <span className="text-[10px] font-medium truncate text-primary">{c.citedPaper?.title}</span>
                    </div>
                    {c.context && (
                      <div className="text-[9px] text-muted-foreground italic truncate pl-3.5">
                        "{c.context}"
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
