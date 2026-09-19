'use client'

import { useState } from 'react'
import { useFetch, useApi } from '@/lib/hooks'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Layers, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { parseTopicIds } from '@/lib/methodology/topic-scope'

interface TopicOption {
  id: string
  name: string
  direction: string
}

interface TopicLinkerProps {
  /** 当前已挂的课题 id（JSON 字符串） */
  topicIds: string
  /** 保存回调：把新的 JSON 字符串交给调用方持久化 */
  onSave: (topicIdsJson: string) => Promise<void> | void
  /** 紧凑模式用于列表行内 */
  compact?: boolean
  className?: string
}

/**
 * 「所属课题」挂载控件。
 *
 * 存在的理由（2026-09-18 用户反馈「AI 研究分析容易在课题多了以后互相干扰」）：
 * 分析的精度取决于「这篇论文/这条笔记属不属于这个课题」这个事实，
 * 而这个事实只有用户知道。所以必须有一个地方让他把关系挂上。
 *
 * 三个刻意设计：
 *  - **多选**：一篇论文常常同时服务两个课题（比如同一套 DRL 方法既用于路由也用于切片），
 *    单选会逼用户复制一份论文记录；
 *  - **无课题时给出引导而不是空控件**：库里一个课题都没有时，这里直接说明
 *    「先去选题评估建课题」，否则用户看到一个空下拉会以为坏了；
 *  - **保存即时**：勾选即写库，不需要再点「保存」—— 挂课题是个轻动作，
 *    多一步确认只会让人懒得挂。
 */
export function TopicLinker({ topicIds, onSave, compact = false, className }: TopicLinkerProps) {
  const { data: topics } = useFetch<TopicOption[]>('/api/topics')
  const api = useApi()
  const [saving, setSaving] = useState(false)
  const [local, setLocal] = useState<string[]>(() => parseTopicIds(topicIds))

  const list = topics ?? []
  const linkedIds = parseTopicIds(topicIds)

  /** 新建课题后直接挂上 —— 用户常常是「挂的时候才发现课题还没建」 */
  const [creating, setCreating] = useState(false)

  const createAndLink = async () => {
    const name = window.prompt('新课题名称（会自动挂到当前条目）')
    if (!name?.trim()) return
    setCreating(true)
    try {
      const created = await api.post('/api/topics', {
        name: name.trim(),
        direction: '',
        description: '',
        scores: '{}',
        totalScore: 0,
      })
      const next = [...new Set([...linkedIds, created.id])]
      setLocal(next)
      await onSave(JSON.stringify(next))
      toast.success(`已创建课题「${created.name}」并挂上`)
      // 让下拉里的课题列表也刷新到最新
      window.setTimeout(() => window.location.reload(), 600)
    } catch {
      toast.error('创建课题失败')
    } finally {
      setCreating(false)
    }
  }

  const toggle = async (id: string) => {
    const next = linkedIds.includes(id) ? linkedIds.filter((x) => x !== id) : [...linkedIds, id]
    setLocal(next)
    setSaving(true)
    try {
      await onSave(JSON.stringify(next))
    } catch {
      toast.error('保存所属课题失败')
      setLocal(linkedIds)
    } finally {
      setSaving(false)
    }
  }

  if (list.length === 0) {
    return (
      <div className={cn('rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[10px] text-amber-700 dark:text-amber-400', className)}>
        还没有任何课题。所属课题决定 AI 研究分析用哪些材料 —— 请先到「选题评估」新建一个课题。
      </div>
    )
  }

  return (
    <div className={cn(compact ? 'space-y-1' : 'space-y-1.5', className)}>
      <div className="flex items-center gap-1.5">
        <Label className={cn('flex items-center gap-1', compact ? 'text-[10px]' : 'text-xs')}>
          <Layers className="h-3 w-3" />
          所属课题
        </Label>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {linkedIds.length === 0 && (
          <span className="text-[10px] text-amber-600">未挂课题 → AI 分析不会用到本条目</span>
        )}
        <button
          onClick={createAndLink}
          disabled={creating}
          className="ml-auto flex items-center gap-0.5 text-[10px] text-primary hover:underline disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
          新建课题
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {list.map((t) => {
          const checked = linkedIds.includes(t.id)
          return (
            <label
              key={t.id}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors',
                checked
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/30'
              )}
            >
              <Checkbox checked={checked} onCheckedChange={() => void toggle(t.id)} className="h-3 w-3" />
              {t.name}
            </label>
          )
        })}
      </div>
      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          勾选后立即保存。一篇论文/笔记可以同时属于多个课题（AI 分析会分别用到）。
          {local.length > 0 && <span className="ml-1">已挂 {local.length} 个。</span>}
        </p>
      )}
    </div>
  )
}

/** 只读展示：列表行里显示「已挂 N 个课题」的小徽章 */
export function TopicBadges({ topicIds }: { topicIds: string }) {
  const ids = parseTopicIds(topicIds)
  const { data: topics } = useFetch<TopicOption[]>('/api/topics')
  if (ids.length === 0) return null
  const names = ids.map((id) => (topics ?? []).find((t) => t.id === id)?.name ?? '已删课题')
  return (
    <>
      {names.map((n) => (
        <Badge key={n} variant="outline" className="text-[9px] px-1 py-0 h-4 font-normal border-primary/30 text-primary">
          <Layers className="h-2 w-2 mr-0.5" />
          {n}
        </Badge>
      ))}
    </>
  )
}
