'use client'

import { useMemo, useState } from 'react'
import { useFetch } from '@/lib/hooks'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { BookOpen, Search, Loader2, Link2Off } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { parsePaperIds } from '@/lib/notes/payload'

interface PaperOption {
  id: string
  title: string
  authors: string
  venue: string
  year: number
}

interface PaperLinkerProps {
  /** 当前已关联的论文 id（JSON 字符串） */
  paperIds: string
  /** 保存回调：把新的 JSON 字符串交给调用方持久化 */
  onSave: (paperIdsJson: string) => Promise<void> | void
  compact?: boolean
  className?: string
}

/** 搜索时的候选条数上限 —— 库里几百篇时不要一次渲染完 */
const MAX_VISIBLE = 12

/**
 * 「关联文献」挂载控件。
 *
 * 与 `TopicLinker` 是同一套设计（即时保存、多选、空态给引导），
 * 差别只在候选集与规模：课题通常个位数，论文可能上百 ——
 * 所以这里多一个搜索框，并且**已关联的永远排在最前**，
 * 否则勾完一篇、列表一刷新它就淹没在几百条里，用户会以为没勾上。
 *
 * 为什么需要这个控件：在此之前「这条笔记写的是哪篇论文」在库里没有任何字段承载，
 * 只能靠标题模糊匹配去猜，而实测标题与论文库没有稳定对应关系 ——
 * 猜错会把作者填成别人。关联必须由用户显式指定。
 */
export function PaperLinker({ paperIds, onSave, compact = false, className }: PaperLinkerProps) {
  const { data: papers } = useFetch<PaperOption[]>('/api/papers')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')

  const list = useMemo(() => papers ?? [], [papers])
  const linkedIds = parsePaperIds(paperIds)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? list.filter((p) =>
          [p.title, p.authors, p.venue, String(p.year)].some((f) => (f || '').toLowerCase().includes(q))
        )
      : list
    // 已关联的排前面，其余保持原顺序
    const linked = matched.filter((p) => linkedIds.includes(p.id))
    const rest = matched.filter((p) => !linkedIds.includes(p.id))
    return [...linked, ...rest].slice(0, MAX_VISIBLE)
  }, [list, query, linkedIds])

  const toggle = async (id: string) => {
    const next = linkedIds.includes(id) ? linkedIds.filter((x) => x !== id) : [...linkedIds, id]
    setSaving(true)
    try {
      await onSave(JSON.stringify(next))
    } catch {
      toast.error('保存关联文献失败')
    } finally {
      setSaving(false)
    }
  }

  if (list.length === 0) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-muted-foreground/40 bg-muted/20 px-2.5 py-2 text-[10px] text-muted-foreground',
          className
        )}
      >
        文献库还是空的。关联文献需要先有论文 —— 请先到「论文库」导入，或用 Zotero 同步一次。
      </div>
    )
  }

  return (
    <div className={cn(compact ? 'space-y-1' : 'space-y-1.5', className)}>
      <div className="flex items-center gap-1.5">
        <Label className={cn('flex items-center gap-1', compact ? 'text-[10px]' : 'text-xs')}>
          <BookOpen className="h-3 w-3" />
          关联文献
        </Label>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {linkedIds.length === 0 && (
          <span className="text-[10px] text-muted-foreground">未关联 → 论文详情里看不到这条笔记</span>
        )}
        {linkedIds.length > 0 && (
          <span className="text-[10px] text-muted-foreground">已关联 {linkedIds.length} 篇</span>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按标题 / 作者 / 期刊 / 年份搜索"
          className="h-7 pl-7 text-[11px]"
        />
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center gap-1 px-1 py-1.5 text-[10px] text-muted-foreground">
          <Link2Off className="h-3 w-3" />
          {query.trim() ? `没有匹配「${query.trim()}」的论文` : '没有可选论文'}
        </div>
      ) : (
        <div className="max-h-40 space-y-0.5 overflow-y-auto pr-0.5">
          {visible.map((p) => {
            const checked = linkedIds.includes(p.id)
            return (
              <label
                key={p.id}
                className={cn(
                  'flex cursor-pointer items-start gap-1.5 rounded-md border px-1.5 py-1 text-[10px] transition-colors',
                  checked
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-transparent hover:border-border hover:bg-muted/40'
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => void toggle(p.id)} className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate', checked ? 'text-primary' : 'text-foreground')}>{p.title}</span>
                  <span className="block truncate text-muted-foreground">
                    {[p.authors, p.venue, p.year].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      )}

      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          勾选后立即保存。一条笔记可以关联多篇论文（例如综述型笔记）。
          {list.length > MAX_VISIBLE && !query.trim() && (
            <span className="ml-1">列表只显示前 {MAX_VISIBLE} 篇，用上面的搜索框找其余 {list.length - MAX_VISIBLE} 篇。</span>
          )}
        </p>
      )}
    </div>
  )
}

/** 只读展示：列表行里显示已关联的论文标题 */
export function PaperBadges({ paperIds }: { paperIds: string }) {
  const ids = parsePaperIds(paperIds)
  const { data: papers } = useFetch<PaperOption[]>('/api/papers')
  if (ids.length === 0) return null
  return (
    <>
      {ids.map((id) => {
        const p = (papers ?? []).find((x) => x.id === id)
        return (
          <Badge
            key={id}
            variant="outline"
            className="h-4 max-w-[220px] px-1 py-0 text-[9px] font-normal border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
          >
            <BookOpen className="mr-0.5 h-2 w-2 shrink-0" />
            <span className="truncate">{p?.title ?? '已删文献'}</span>
          </Badge>
        )
      })}
    </>
  )
}
