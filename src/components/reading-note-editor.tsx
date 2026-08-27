'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useApi } from '@/lib/hooks'
import { toast } from 'sonner'
import {
  BookOpen,
  Save,
  Clock,
  FileSpreadsheet,
  Download,
  BookMarked,
  Quote,
  FlaskConical,
  Target,
  Library,
  Lightbulb,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'

interface ReadingNoteNote {
  id: string
  title: string
  content: string
  tags: string
  category: string
  structured?: Record<string, string>
  lastReadAt?: string | null
  updatedAt: string
}

/** 文献阅读思考模板的字段定义（顺序即展示顺序/导出优先级） */
const STRUCT_FIELDS: {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  placeholder: string
  rows: number
}[] = [
  { key: 'terms', label: '术语记录', icon: BookMarked, placeholder: '本文关键术语/缩写释义…', rows: 2 },
  { key: 'refs', label: '参考文献导入', icon: Quote, placeholder: '本笔记引用的参考文献（作者. 标题. 期刊, 年份…）\n每条一行', rows: 3 },
  { key: 'method', label: '研究方法', icon: FlaskConical, placeholder: '本文使用了什么方法/模型/算法？', rows: 3 },
  { key: 'object', label: '研究对象', icon: Target, placeholder: '研究对象/场景/问题是什么？', rows: 3 },
  { key: 'framework', label: '理论框架', icon: Library, placeholder: '建立在什么理论/框架之上？', rows: 3 },
  { key: 'innovation', label: '创新点', icon: Lightbulb, placeholder: '相比已有工作的创新之处…', rows: 3 },
  { key: 'limitation', label: '局限性', icon: AlertTriangle, placeholder: '本文的不足/假设/未解决的问题…', rows: 3 },
  { key: 'inspiration', label: '对我的启发', icon: Sparkles, placeholder: '对本人研究/选题的启发…', rows: 3 },
]

interface ReadingNoteEditorProps {
  note: ReadingNoteNote
  onUpdate: (n: ReadingNoteNote) => void
}

/** 文献阅读思考模板：把一篇论文的阅读思考，按结构化字段逐项填写 */
export function ReadingNoteEditor({ note, onUpdate }: ReadingNoteEditorProps) {
  const api = useApi()
  const structured = note.structured ?? {}
  const [author, setAuthor] = useState(structured.author || '')
  const [journal, setJournal] = useState(structured.journal || '')
  const [title, setTitle] = useState(note.title)
  const [fields, setFields] = useState<Record<string, string>>(
    Object.fromEntries(STRUCT_FIELDS.map((f) => [f.key, structured[f.key] ?? '']))
  )
  const [saving, setSaving] = useState(false)

  const buildStructured = () => ({ author, journal, ...fields })

  const save = async (opts: { readNow?: boolean } = {}) => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        title,
        category: 'literature',
        structured: buildStructured(),
      }
      if (opts.readNow) payload.lastReadAt = new Date().toISOString()
      const updated = await api.put(`/api/notes/${note.id}`, payload)
      onUpdate({ ...note, ...updated, structured: buildStructured() })
      toast.success(opts.readNow ? '已保存并记录本次阅读' : '已保存')
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const exportExcel = async () => {
    try {
      const res = await fetch(`/api/notes/export/xlsx?category=literature`)
      if (!res.ok) throw new Error('bad response')
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename\*=UTF-8''(.+)/)
      const filename = m ? decodeURIComponent(m[1]) : '文献阅读笔记.xlsx'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast.success('已导出为 Excel')
    } catch {
      toast.error('导出 Excel 失败')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-primary" />
          文献阅读思考模板
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          阅读时逐项填写思考，保存后可在论文库/综述写作中复用，并一键导出 Excel。
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 元数据：题目 / 作者 / 期刊 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label>题目 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="论文标题" />
          </div>
          <div>
            <Label>作者</Label>
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="作者（逗号分隔）" />
          </div>
          <div>
            <Label>期刊 / 会议</Label>
            <Input value={journal} onChange={(e) => setJournal(e.target.value)} placeholder="IEEE TCOM, 2019…" />
          </div>
        </div>

        {/* 最近阅读时间 + 操作 */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px] py-0 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            最近阅读：
            {note.lastReadAt ? new Date(note.lastReadAt).toLocaleDateString('zh-CN') : '未记录'}
          </Badge>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportExcel}>
              <FileSpreadsheet className="h-3 w-3 mr-1" /> 导出 Excel
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => save({ readNow: true })} disabled={saving}>
              <Download className="h-3 w-3 mr-1" /> 记录本次阅读
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => save()} disabled={saving}>
              <Save className="h-3 w-3 mr-1" /> 保存
            </Button>
          </div>
        </div>

        {/* 结构化思考字段 */}
        <div className="grid grid-cols-1 gap-3">
          {STRUCT_FIELDS.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.key}>
                <Label className="flex items-center gap-1.5 text-xs">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  {f.label}
                </Label>
                <Textarea
                  value={fields[f.key] ?? ''}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="text-xs min-h-[54px]"
                  rows={f.rows}
                />
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export type { ReadingNoteNote }
