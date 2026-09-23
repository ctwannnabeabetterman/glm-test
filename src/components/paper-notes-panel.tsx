'use client'

import { useState } from 'react'
import { useFetch, useApi } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StickyNote, Plus, Loader2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import { parsePaperIds } from '@/lib/notes/payload'

interface NoteRow {
  id: string
  title: string
  content: string
  category: string
  paperIds?: string
  updatedAt: string
}

/** 把 markdown 正文压成一行摘要 —— 只为了在列表里能认出是哪条笔记，不追求渲染 */
function excerpt(md: string, max = 110): string {
  const flat = (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`\-!\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

/**
 * 论文详情里的「相关笔记」。
 *
 * 这是「笔记 ↔ 论文」这条通路的**反向一半**：笔记详情里用 `<PaperLinker>` 挂论文，
 * 这里把挂上来的笔记列出来。此前两个模块之间没有任何字段级通路，
 * 用户从论文出发根本看不到自己为它写过什么。
 *
 * 为什么不加新接口：`GET /api/notes` 本来就读全量（笔记在百条量级），
 * 前端按 `paperIds` 过滤即可。多一个查询参数意味着多一处要维护的筛选口径，
 * 而现在筛选逻辑只有 `parsePaperIds` 一个来源。
 */
export function PaperNotesPanel({ paperId, paperTitle }: { paperId: string; paperTitle: string }) {
  const { data: notes, refetch } = useFetch<NoteRow[]>('/api/notes')
  const api = useApi()
  const setSection = useAppStore((s) => s.setSection)
  const [creating, setCreating] = useState(false)

  const linked = (notes ?? []).filter((n) => parsePaperIds(n.paperIds).includes(paperId))

  const createNote = async () => {
    setCreating(true)
    try {
      await api.post('/api/notes', {
        title: `阅读笔记 · ${paperTitle}`.slice(0, 120),
        content: '',
        category: 'literature',
        paperIds: [paperId],
      })
      toast.success('已新建笔记并关联这篇论文')
      refetch()
      setSection('notes')
    } catch (e) {
      toast.error('新建笔记失败：' + (e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <StickyNote className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs">相关笔记</span>
        {linked.length > 0 && (
          <Badge variant="secondary" className="h-4 px-1 py-0 text-[9px]">
            {linked.length}
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-1.5 text-[10px]"
          disabled={creating}
          onClick={() => void createNote()}
        >
          {creating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
          新建并关联
        </Button>
      </div>

      {linked.length === 0 ? (
        <p className="px-0.5 text-[10px] text-muted-foreground">
          还没有为这篇论文写过笔记。可以点右上角新建，或到「科研笔记」里用详情页的「关联文献」挂上已有笔记。
        </p>
      ) : (
        <div className="space-y-1">
          {linked.map((n) => (
            <button
              key={n.id}
              onClick={() => setSection('notes')}
              className="group flex w-full items-start gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border hover:bg-background"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium">{n.title}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {excerpt(n.content) || '（空笔记）'}
                </span>
              </span>
              <span className="shrink-0 pt-0.5 text-[9px] text-muted-foreground">
                {new Date(n.updatedAt).toLocaleDateString('zh-CN')}
              </span>
              <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
