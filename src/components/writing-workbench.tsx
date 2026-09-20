'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  BookMarked,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FilePlus2,
  Link2,
  Loader2,
  Plus,
  Quote,
  Search,
  Target,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import {
  CITATION_STYLE_PRESETS,
  findCitationStylePreset,
  referenceBody,
  type CitationStyle,
} from '@/lib/writing/citation-styles'
import {
  collectCitationIds,
  countWords,
  newSection,
  sectionProgress,
  totalWords,
  writingProgress,
  type DraftSection,
  type ResolvedReference,
} from '@/lib/writing/draft'
import type { ManuscriptDto } from '@/lib/writing/dto'

interface PaperOption {
  id: string
  title: string
  authors: string
  venue: string
  year: number
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const AUTOSAVE_DELAY = 800

export function WritingWorkbench() {
  const [items, setItems] = useState<ManuscriptDto[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [papers, setPapers] = useState<PaperOption[]>([])
  const [refs, setRefs] = useState<ResolvedReference[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState('')
  const [query, setQuery] = useState('')

  // 引文样式是**全局偏好**（不是每篇稿件一个字段）：换样式只是换渲染，
  // 不涉及数据，因此不需要给 Manuscript 加列、不需要迁移库 —— 升级零风险。
  const citationStyle = useAppStore((s) => s.citationStyle)
  const setCitationStyle = useAppStore((s) => s.setCitationStyle)
  const draftInbox = useAppStore((s) => s.draftInbox)
  const takeDraftInbox = useAppStore((s) => s.takeDraftInbox)
  const stylePreset = findCitationStylePreset(citationStyle)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ id: string; payload: Record<string, unknown> } | null>(null)

  const active = useMemo(() => items.find((i) => i.id === activeId) ?? null, [items, activeId])
  const sections = useMemo<DraftSection[]>(() => active?.sections ?? [], [active])
  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeSectionId) ?? sections[0] ?? null,
    [sections, activeSectionId],
  )
  const progress = writingProgress(sections, active?.targetWords ?? 0)
  const citationIds = useMemo(() => collectCitationIds(sections), [sections])
  const citationKey = citationIds.join('|')
  const activeSectionWords = countWords(activeSection?.content)

  // ---------- 保存（防抖 + 合并同一稿件的多次修改） ----------
  const flush = useCallback(async () => {
    const job = pending.current
    if (!job) return
    pending.current = null
    setSaveState('saving')
    try {
      const res = await fetch(`/api/writing/manuscripts/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job.payload),
      })
      if (!res.ok) throw new Error('save failed')
      setSaveState('saved')
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    } catch {
      setSaveState('error')
      // 失败时把 payload 放回去，用户可以按 Ctrl+S 重试，不至于白写
      if (!pending.current) pending.current = job
    }
  }, [])

  const scheduleSave = useCallback(
    (id: string, payload: Record<string, unknown>) => {
      const prev = pending.current
      pending.current = {
        id,
        payload: prev && prev.id === id ? { ...prev.payload, ...payload } : { ...payload },
      }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY)
    },
    [flush],
  )

  // 切走前把没落盘的改动写下去，避免"看着在、其实没存"
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void flush()
    }
  }, [flush])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (saveTimer.current) clearTimeout(saveTimer.current)
        void flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flush])

  // ---------- 数据加载 ----------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/writing/manuscripts')
        const data = await res.json()
        const list: ManuscriptDto[] = Array.isArray(data) ? data : []
        if (cancelled) return
        setItems(list)
        setActiveId(list[0]?.id ?? null)
        setActiveSectionId(list[0]?.sections?.[0]?.id ?? null)
      } catch {
        toast.error('稿件加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    fetch('/api/papers')
      .then((r) => r.json())
      .then((d) => setPapers(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  // 引用一变化就重算参考文献（服务端算，保证与导出完全一致）
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      // 「没有激活稿件就先清空」也放进定时回调里：effect 体内同步 setState 会触发
      // 级联渲染（react-hooks/set-state-in-effect），放到异步回调里就没有这个问题。
      if (!activeId) {
        setRefs([])
        setMissing([])
        return
      }
      try {
        const res = await fetch(`/api/writing/manuscripts/${activeId}/references`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setRefs(Array.isArray(data.references) ? data.references : [])
        setMissing(Array.isArray(data.missing) ? data.missing : [])
      } catch {
        /* 参考文献是辅助信息，取不到不打断写作 */
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [activeId, citationKey])

  // ---------- 修改 ----------
  const patchActive = useCallback(
    (patch: Partial<Pick<ManuscriptDto, 'title' | 'venue' | 'targetWords' | 'sections'>>) => {
      if (!active) return
      setItems((prev) =>
        prev.map((it) =>
          it.id === active.id
            ? { ...it, ...patch, words: patch.sections ? totalWords(patch.sections) : it.words }
            : it,
        ),
      )
      scheduleSave(active.id, patch as Record<string, unknown>)
    },
    [active, scheduleSave],
  )

  const patchSection = useCallback(
    (sectionId: string, patch: Partial<DraftSection>) => {
      const next = sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s))
      patchActive({ sections: next })
    },
    [sections, patchActive],
  )

  const addSection = useCallback(() => {
    const s = newSection('新章节', 0)
    patchActive({ sections: [...sections, s] })
    setActiveSectionId(s.id)
  }, [sections, patchActive])

  const removeSection = useCallback(
    (sectionId: string) => {
      const idx = sections.findIndex((s) => s.id === sectionId)
      const next = sections.filter((s) => s.id !== sectionId)
      patchActive({ sections: next })
      setActiveSectionId(next[Math.max(0, idx - 1)]?.id ?? null)
    },
    [sections, patchActive],
  )

  const moveSection = useCallback(
    (sectionId: string, delta: number) => {
      const idx = sections.findIndex((s) => s.id === sectionId)
      const target = idx + delta
      if (idx < 0 || target < 0 || target >= sections.length) return
      const next = [...sections]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      patchActive({ sections: next })
    },
    [sections, patchActive],
  )

  const insertCitation = useCallback(
    (paperId: string) => {
      if (!activeSection) {
        toast.error('请先选择一个章节')
        return
      }
      const marker = `[@${paperId}]`
      const ta = textareaRef.current
      const content = activeSection.content ?? ''
      const start = ta?.selectionStart ?? content.length
      const end = ta?.selectionEnd ?? start
      const next = content.slice(0, start) + marker + content.slice(end)
      patchSection(activeSection.id, { content: next })
      const caret = start + marker.length
      requestAnimationFrame(() => {
        ta?.focus()
        ta?.setSelectionRange(caret, caret)
      })
    },
    [activeSection, patchSection],
  )

  /**
   * 接收「AI 综述 → 写作」的一次性投递（见 store 的 DraftInbox）。
   *
   * 为什么要这条通道：综述面板产出的正文里带的是 `[@paperId]` 标记，
   * **只有本组件能把它们解析成编号与参考文献表**。没有这条通道，
   * 用户得自己复制 → 切页 → 选章节 → 粘到光标处，还要保证粘对地方。
   *
   * 「没有稿件时不清空」是刻意的：投递早于新建稿件是正常顺序，
   * 让它在内存里等一会儿，用户点「新建稿件」后 effect 会立刻补插。
   */
  useEffect(() => {
    if (!draftInbox || !active) return
    // effect 体内同步调 store 会触发级联渲染（react-hooks/set-state-in-effect），
    // 放进定时回调里就没这个问题 —— 与上文重算参考文献用的是同一招。
    const t = setTimeout(() => {
      const job = takeDraftInbox()
      if (!job) return
      const section = { ...newSection(job.title, 0), content: job.content }
      setItems((prev) =>
        prev.map((it) =>
          it.id === active.id
            ? { ...it, sections: [...it.sections, section], words: totalWords([...it.sections, section]) }
            : it,
        ),
      )
      scheduleSave(active.id, { sections: [...active.sections, section] })
      setActiveSectionId(section.id)
      toast.success('AI 综述草稿已插入新章节 —— 引用会自动编号')
    }, 0)
    return () => clearTimeout(t)
  }, [draftInbox, active, takeDraftInbox, scheduleSave])

  const createManuscript = useCallback(async () => {
    try {
      const res = await fetch('/api/writing/manuscripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const created = await res.json()
      if (!res.ok || !created?.id) throw new Error('create failed')
      setItems((prev) => [created, ...prev])
      setActiveId(created.id)
      setActiveSectionId(created.sections?.[0]?.id ?? null)
      toast.success('已新建稿件（含默认章节骨架）')
    } catch {
      toast.error('新建稿件失败')
    }
  }, [])

  const deleteManuscript = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/writing/manuscripts/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('delete failed')
        setItems((prev) => {
          const next = prev.filter((i) => i.id !== id)
          setActiveId(next[0]?.id ?? null)
          setActiveSectionId(next[0]?.sections?.[0]?.id ?? null)
          return next
        })
        toast.success('稿件已删除')
      } catch {
        toast.error('删除失败')
      }
    },
    [],
  )

  const downloadExport = useCallback(
    (format: 'md' | 'txt') => {
      if (!active) return
      const a = document.createElement('a')
      // 带上 style：导出的参考文献必须与右侧预览**用的是同一种格式**，
      // 否则用户看到的是 GB/T、拿到的是 IEEE，还很难发现。
      a.href = `/api/writing/manuscripts/${active.id}/export?format=${format}&style=${citationStyle}`
      a.download = ''
      document.body.appendChild(a)
      a.click()
      a.remove()
    },
    [active, citationStyle],
  )

  const filteredPapers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? papers.filter((p) =>
          `${p.title} ${p.authors} ${p.venue}`.toLowerCase().includes(q),
        )
      : papers
    return list.slice(0, 8)
  }, [papers, query])

  if (loading) {
    return (
      <div className="grid gap-3 lg:grid-cols-[260px_1fr_300px]">
        <Skeleton className="h-[420px] rounded-lg" />
        <Skeleton className="h-[420px] rounded-lg" />
        <Skeleton className="h-[420px] rounded-lg" />
      </div>
    )
  }

  if (!active) {
    return (
      <Card>
        <CardContent className="py-14 text-center space-y-3">
          <BookMarked className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            还没有稿件。新建一篇会自动带上 Abstract / Introduction / Method 等默认章节。
          </p>
          {draftInbox && (
            <p className="text-xs text-primary">
              已收到「{draftInbox.title}」，新建稿件后会立即插入为新章节。
            </p>
          )}
          <Button onClick={createManuscript}>
            <FilePlus2 className="h-4 w-4 mr-2" />
            新建稿件
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {/* 顶部：稿件信息 + 总进度 + 导出 */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={active.id}
              onChange={(e) => {
                const next = items.find((i) => i.id === e.target.value)
                setActiveId(e.target.value)
                setActiveSectionId(next?.sections?.[0]?.id ?? null)
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm max-w-[260px] transition-colors"
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title || '未命名稿件'}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={createManuscript}>
              <FilePlus2 className="h-3.5 w-3.5 mr-1.5" />
              新建
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  删除
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除这篇稿件？</AlertDialogTitle>
                  <AlertDialogDescription>
                    「{active.title || '未命名稿件'}」的章节与正文会一并删除，且无法撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void deleteManuscript(active.id)}>
                    确认删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <div className="ml-auto flex items-center gap-2">
              <SaveIndicator state={saveState} savedAt={savedAt} onRetry={() => void flush()} />
              <Badge variant="outline" className="text-[10px]" title={`导出会按 ${stylePreset.name} 著录参考文献`}>
                {stylePreset.name}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadExport('md')}
                title={`导出 Markdown（参考文献按 ${stylePreset.name} 著录）`}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                导出 md
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadExport('txt')}
                title={`导出纯文本（参考文献按 ${stylePreset.name} 著录）`}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                导出 txt
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_200px_200px]">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">稿件标题</Label>
              <Input
                value={active.title}
                onChange={(e) => patchActive({ title: e.target.value })}
                placeholder="未命名稿件"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">目标期刊 / 会议</Label>
              <Input
                value={active.venue}
                onChange={(e) => patchActive({ venue: e.target.value })}
                placeholder="例如 IEEE JSAC"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">全稿目标字数</Label>
              <Input
                type="number"
                min={0}
                value={active.targetWords || ''}
                onChange={(e) => patchActive({ targetWords: Math.max(0, Number(e.target.value) || 0) })}
                placeholder="0 = 不设目标"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground inline-flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5" />
                全稿进度
              </span>
              <span className="tabular-nums">
                <span className="font-medium">{progress.words}</span>
                <span className="text-muted-foreground">
                  {progress.target > 0 ? ` / ${progress.target} 字 · ${progress.percent}%` : ' 字'}
                </span>
                {progress.target > 0 && progress.remaining > 0 && (
                  <span className="text-muted-foreground"> · 还差 {progress.remaining}</span>
                )}
                {progress.target > 0 && progress.remaining === 0 && (
                  <span className="text-muted-foreground"> · 已达成</span>
                )}
              </span>
            </div>
            <Progress value={progress.target > 0 ? progress.percent : 0} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* 左：大纲 */}
        <Card className="lg:sticky lg:top-4 self-start">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              章节大纲
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={addSection} title="新增章节">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1">
            {sections.length === 0 && (
              <p className="text-xs text-muted-foreground py-3 text-center">还没有章节，点右上角 + 添加</p>
            )}
            {sections.map((s, idx) => {
              const p = sectionProgress(s)
              const isActive = s.id === (activeSection?.id ?? '')
              return (
                <div
                  key={s.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md pr-1 transition-colors',
                    isActive ? 'bg-accent' : 'hover:bg-muted',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveSectionId(s.id)}
                    className="flex-1 min-w-0 text-left px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-[10px] tabular-nums w-4 shrink-0',
                          isActive ? 'text-accent-foreground/70' : 'text-muted-foreground/60',
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span className="text-sm truncate flex-1">{s.title}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                        {p.words}
                        {p.target > 0 ? `/${p.target}` : ''}
                      </span>
                    </div>
                    <Progress value={p.target > 0 ? p.percent : 0} className="h-1 mt-1.5" />
                  </button>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={idx === 0}
                      onClick={() => moveSection(s.id, -1)}
                      title="上移"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={idx === sections.length - 1}
                      onClick={() => moveSection(s.id, 1)}
                      title="下移"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => removeSection(s.id)}
                      title="删除章节"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* 中：编辑器 */}
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_130px]">
              <Input
                value={activeSection?.title ?? ''}
                onChange={(e) => activeSection && patchSection(activeSection.id, { title: e.target.value })}
                placeholder="章节标题"
                className="font-medium"
              />
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={activeSection?.targetWords || ''}
                  onChange={(e) =>
                    activeSection &&
                    patchSection(activeSection.id, { targetWords: Math.max(0, Number(e.target.value) || 0) })
                  }
                  placeholder="目标字数"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {activeSection ? (
              <>
                <Textarea
                  ref={textareaRef}
                  value={activeSection.content}
                  onChange={(e) => patchSection(activeSection.id, { content: e.target.value })}
                  placeholder="在此撰写本章节。用「插入引用」把文献库里的论文引到这里，导出时会自动编号并生成参考文献。"
                  className="min-h-[360px] resize-y leading-relaxed font-[var(--font-geist-sans)]"
                />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="tabular-nums">
                    本章 {activeSectionWords} 字
                    {activeSection.targetWords > 0 && ` / 目标 ${activeSection.targetWords}`}
                  </span>
                  <span>快捷键 ⌘/Ctrl + S 立即保存 · 正文用 [@ 引用] 标记</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">请先在左侧添加一个章节</p>
            )}
          </CardContent>
        </Card>

        {/* 右：引用 + 参考文献 */}
        <div className="space-y-3 lg:sticky lg:top-4 self-start">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                插入引用
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索文献库（题名/作者/会议）"
                  className="pl-7 h-8 text-sm"
                />
              </div>
              <div className="max-h-[200px] overflow-y-auto -mx-1 px-1 space-y-0.5">
                {filteredPapers.length === 0 && (
                  <p className="text-[11px] text-muted-foreground py-2 text-center">
                    {papers.length === 0 ? '文献库为空，先去「论文库」导入文献' : '没有匹配的文献'}
                  </p>
                )}
                {filteredPapers.map((p) => {
                  const cited = citationIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => insertCitation(p.id)}
                      className="w-full text-left rounded px-2 py-1.5 text-xs hover:bg-muted transition-colors flex items-start gap-1.5"
                      title="插入到光标位置"
                    >
                      <Quote className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/60" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2">{p.title}</span>
                        <span className="block text-[10px] text-muted-foreground truncate">
                          {[p.authors, p.venue, p.year].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {cited && <Check className="h-3 w-3 mt-0.5 shrink-0 text-primary" />}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <BookMarked className="h-3.5 w-3.5" />
                  参考文献
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  {refs.length} 条
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {/* 著录格式切换：换的只是「一条题录渲染成什么字符串」，
                  正文编号与稿件数据都不动，所以是即时预览、不需要重算。 */}
              <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
                <Label className="text-[10px] text-muted-foreground">参考文献著录格式</Label>
                <select
                  aria-label="参考文献著录格式"
                  value={citationStyle}
                  onChange={(e) => setCitationStyle(e.target.value as CitationStyle)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs transition-colors"
                >
                  {CITATION_STYLE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{stylePreset.summary}</p>
                <p className="text-[10px] leading-relaxed break-words rounded bg-background/70 px-1.5 py-1 text-muted-foreground">
                  {stylePreset.sample}
                </p>
              </div>

              {missing.length > 0 && (
                <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px]">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
                  <span>
                    有 {missing.length} 条引用在文献库里找不到：{missing.slice(0, 3).join('、')}
                    {missing.length > 3 ? ' 等' : ''}
                  </span>
                </div>
              )}
              {refs.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-2 text-center">
                  正文里还没有引用。用上面的搜索插入 [@论文] 即可。
                </p>
              ) : (
                <ol className="max-h-[260px] overflow-y-auto space-y-1.5 -mx-1 px-1">
                  {refs.map((r) => (
                    <li key={r.paperId} className="text-[11px] leading-relaxed text-muted-foreground">
                      <span className={cn('tabular-nums', !r.found && 'text-destructive')}>[{r.number}]</span>{' '}
                      {referenceBody(r, citationStyle)}
                    </li>
                  ))}
                </ol>
              )}
              <Separator />
              <p className="text-[10px] text-muted-foreground">
                编号按正文首次出现顺序自动生成，删段或调序后会重排；导出与预览使用同一份来源。
                库里没有卷、期、页码，著录时不会编造，投稿前请自行补齐。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SaveIndicator({
  state,
  savedAt,
  onRetry,
}: {
  state: SaveState
  savedAt: string
  onRetry: () => void
}) {
  if (state === 'saving') {
    return (
      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        保存中
      </span>
    )
  }
  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="text-[11px] text-destructive inline-flex items-center gap-1 hover:underline"
      >
        <TriangleAlert className="h-3 w-3" />
        保存失败，点此重试
      </button>
    )
  }
  if (state === 'saved') {
    return (
      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 tabular-nums">
        <Check className="h-3 w-3 text-primary" />
        已保存 {savedAt}
      </span>
    )
  }
  return null
}
