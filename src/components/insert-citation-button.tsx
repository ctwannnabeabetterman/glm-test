'use client'

import { Button } from '@/components/ui/button'
import { Quote } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * 「把这几篇引到稿子里」的复用按钮 —— 引用追踪、论文详情、关系网络都用它。
 *
 * 它替掉的是三步手工动作：复制题录 → 切到写作页 → 找到章节粘到光标处。
 * 这里一次点击完成：生成 `[@id]`（多篇合成 `[@a, @b]`）→ 经 store 的一次性投递
 * 送进写作工作台 → 落到 `Related Work` 章节末尾（没有该章节时按规则回落，
 * 见 `pickAppendTarget`）→ 自动切到写作页，让用户**当场看到**它落在哪。
 *
 * 为什么用「标记」而不是整句文本：标记是 `draft.ts` 里 `INLINE_MARKER_RE` 认识的语法，
 * 编号与参考文献表都由写作工作台统一生成（IEEE / GB-T 7714 任选）。
 * 工具在这里替用户写句子，反而会把「该说什么」也一并替他决定 —— 那是研究者的活。
 */
export interface CitationTarget {
  id: string
  title?: string
}

export function InsertCitationButton({
  papers,
  label = '插入引用',
  size = 'sm',
  variant = 'outline',
  className,
  targetTitle = 'Related Work',
  showIcon = true,
}: {
  /** 单篇传 id 字符串，多篇传数组（会合成一处引用 `[@a, @b]`） */
  papers: string | CitationTarget[]
  label?: string
  size?: 'sm' | 'default' | 'icon'
  variant?: 'outline' | 'ghost' | 'secondary' | 'default'
  className?: string
  /** 优先落到的章节名；匹配不到会回落到「最后一个有内容的章节」 */
  targetTitle?: string
  showIcon?: boolean
}) {
  const sendDraftToWriting = useAppStore((s) => s.sendDraftToWriting)
  const setSection = useAppStore((s) => s.setSection)

  const ids = (typeof papers === 'string' ? [papers] : papers.map((p) => p.id)).filter(Boolean)
  if (ids.length === 0) return null

  const onClick = () => {
    // 一个位置引用多篇 ⇒ 合成一个标记（`[@a, @b]`），与写作工作台的解析语法一致
    const marker = `[@${ids.join(', ')}]`
    sendDraftToWriting({ content: marker, title: '引用', mode: 'append', targetTitle })
    setSection('writing')
    toast.success(
      ids.length === 1
        ? `已送到写作工作台：${marker}（落在 Related Work 章节末尾）`
        : `已把 ${ids.length} 条引用合成一处送到写作工作台：${marker.slice(0, 40)}${marker.length > 40 ? '…' : ''}`,
    )
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn(className)}
      onClick={onClick}
      title={`生成 ${ids.length === 1 ? '[@引用]' : `[@${ids.length} 篇合成引用]`} 并插入到稿件的「${targetTitle}」章节（没有该章节时落到最后一个有内容的章节）`}
    >
      {showIcon && <Quote className="h-3 w-3 mr-1" />}
      {label}
    </Button>
  )
}
