'use client'

import { useState } from 'react'
import { Copy, NotebookPen, Send, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useApi } from '@/lib/hooks'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export interface AiOutputActionsProps {
  /** AI 生成的正文（markdown） */
  content: string
  /** 存为笔记时的标题；调用方应带上来源，例：`AI 快速摘要 · <论文标题>` */
  noteTitle: string
  /** 笔记归类，默认 knowledge（AI 产出不是「文献阅读笔记」本身） */
  noteCategory?: string
  /** 若这条输出源自某篇论文，一并关联，方便在论文详情里回看 */
  paperId?: string
  /** 送到写作时的建议章节名，默认用 noteTitle */
  draftTitle?: string
  /** 是否显示「送到写作」（纯建议类输出也允许送，默认允许） */
  allowDraft?: boolean
  compact?: boolean
  className?: string
}

/**
 * 「AI 输出的统一落地操作栏」。
 *
 * 存在的理由（2026-09-23 用户反馈「AI 说的话可以导入吗」）：
 * 在它出现之前，全应用 10 项 AI 能力里只有「AI 综述」一条能把结果送出面板，
 * 其余 6 项（摘要 / 摘要生成 / 方向探索 / 实验建议 / 研究空白 / 相关论文）
 * 的结果只活在组件自己的 `useState` 里，**只有一个「复制」按钮，关掉页面就没了**。
 * 用户拿到一段好内容却留不住，等于白生成。
 *
 * 三个动作，对应三种真实去向：
 *  - **复制** —— 老行为，留着（有人就是习惯粘到别处）；
 *  - **存为笔记** —— 落库成 Note；走现成的 `POST /api/notes`，不需要新接口；
 *  - **送到写作** —— 投给写作工作台并**立刻切页**。
 *
 * ⚠️ 「立刻切页」是刻意的：`draftInbox` 是一次性投递且**不持久化**（有意为之，
 * 见 store 里的说明）。如果只投递不切页，用户先去别的模块转一圈、或者顺手关了应用，
 * 那段正文就被 `takeDraftInbox` 静默丢掉。切页把「投递」和「落点」压在同一次交互里，
 * 就不存在丢失窗口了。
 */
export function AiOutputActions({
  content,
  noteTitle,
  noteCategory = 'knowledge',
  paperId,
  draftTitle,
  allowDraft = true,
  compact = false,
  className,
}: AiOutputActionsProps) {
  const api = useApi()
  const sendDraftToWriting = useAppStore((s) => s.sendDraftToWriting)
  const setSection = useAppStore((s) => s.setSection)
  const [savingNote, setSavingNote] = useState(false)
  const [copied, setCopied] = useState(false)

  const text = (content || '').trim()
  if (!text) return null

  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
    toast.success('已复制到剪贴板')
  }

  const saveAsNote = async () => {
    setSavingNote(true)
    try {
      const created = await api.post('/api/notes', {
        title: noteTitle.slice(0, 120),
        content: text,
        category: noteCategory,
        // 数组会被服务端归一成 JSON 字符串（见 lib/notes/payload.ts）
        paperIds: paperId ? [paperId] : [],
      })
      toast.success(`已存为笔记「${created?.title ?? noteTitle}」`, {
        action: { label: '去看', onClick: () => setSection('notes') },
      })
    } catch (e) {
      toast.error('存为笔记失败：' + (e as Error).message)
    } finally {
      setSavingNote(false)
    }
  }

  const sendToDraft = () => {
    sendDraftToWriting({ content: text, title: draftTitle || noteTitle, mode: 'section' })
    // 立刻切页 —— 否则这段正文会因为 draftInbox 不持久化而丢失
    setSection('writing')
    toast.success('已发到写作工作台，正在切换…')
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <button
        onClick={copy}
        className={cn(
          'flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground',
          compact ? 'text-[10px]' : 'text-[11px]'
        )}
      >
        {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
        复制
      </button>

      <span className="text-muted-foreground/40">·</span>

      <button
        onClick={() => void saveAsNote()}
        disabled={savingNote}
        className={cn(
          'flex items-center gap-1 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50',
          compact ? 'text-[10px]' : 'text-[11px]'
        )}
      >
        {savingNote ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <NotebookPen className="h-2.5 w-2.5" />}
        存为笔记
      </button>

      {allowDraft && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <button
            onClick={sendToDraft}
            className={cn(
              'flex items-center gap-1 text-muted-foreground transition-colors hover:text-primary',
              compact ? 'text-[10px]' : 'text-[11px]'
            )}
          >
            <Send className="h-2.5 w-2.5" />
            送到写作
          </button>
        </>
      )}
    </div>
  )
}
