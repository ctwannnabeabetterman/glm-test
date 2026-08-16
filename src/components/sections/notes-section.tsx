'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionHeader } from './papers-section'
import { KnowledgeGraph } from '@/components/knowledge-graph'
import { NoteTemplates } from '@/components/note-templates'
import { NotesExport } from '@/components/notes-export'
import {
  StickyNote,
  Plus,
  Trash2,
  Pencil,
  Search,
  Tag,
  Clock,
  FileText,
  Network,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Note {
  id: string
  title: string
  content: string
  tags: string
  links: string
  category: string
  createdAt: string
  updatedAt: string
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  literature: { label: '文献笔记', color: 'bg-blue-500/15 text-blue-600' },
  project: { label: '项目笔记', color: 'bg-emerald-500/15 text-emerald-600' },
  knowledge: { label: '知识库', color: 'bg-purple-500/15 text-purple-600' },
  template: { label: '模板', color: 'bg-amber-500/15 text-amber-600' },
  daily: { label: '日志', color: 'bg-slate-500/15 text-slate-600' },
}

export function NotesSection() {
  const { data: notes, refetch, loading } = useFetch<Note[]>('/api/notes')
  const api = useApi()
  const [selected, setSelected] = useState<Note | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [newNote, setNewNote] = useState({
    title: '',
    content: '',
    tags: '',
    category: 'literature',
  })

  const filtered = (notes ?? []).filter((n) => {
    if (search && !n.title.toLowerCase().includes(search.toLowerCase()) && !n.content.toLowerCase().includes(search.toLowerCase())) return false
    if (categoryFilter !== 'all' && n.category !== categoryFilter) return false
    return true
  })

  const handleAdd = async () => {
    if (!newNote.title.trim()) {
      toast.error('请填写标题')
      return
    }
    try {
      const created = await api.post('/api/notes', newNote)
      toast.success('笔记已创建')
      setAddOpen(false)
      setNewNote({ title: '', content: '', tags: '', category: 'literature' })
      refetch()
      setSelected(created)
    } catch {
      toast.error('创建失败')
    }
  }

  const handleDelete = async (note: Note) => {
    if (!confirm(`删除笔记「${note.title}」？`)) return
    try {
      await api.del(`/api/notes/${note.id}`)
      toast.success('已删除')
      if (selected?.id === note.id) setSelected(null)
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="科研笔记"
        desc="Obsidian 风格 · Markdown · 双向链接 · 多维分类"
        icon={StickyNote}
        action={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                新建笔记
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>新建笔记</DialogTitle>
                <DialogDescription>方法论 §2.2.3 Obsidian 双向链接笔记法</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>标题 *</Label>
                  <Input value={newNote.title} onChange={(e) => setNewNote({ ...newNote, title: e.target.value })} />
                </div>
                <div>
                  <Label>分类</Label>
                  <Select value={newNote.category} onValueChange={(v) => setNewNote({ ...newNote, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="literature">文献笔记</SelectItem>
                      <SelectItem value="project">项目笔记</SelectItem>
                      <SelectItem value="knowledge">知识库</SelectItem>
                      <SelectItem value="template">模板</SelectItem>
                      <SelectItem value="daily">日志</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>标签 (逗号分隔)</Label>
                  <Input value={newNote.tags} onChange={(e) => setNewNote({ ...newNote, tags: e.target.value })} placeholder="DRL,资源分配,基线" />
                </div>
                <div>
                  <Label>内容 (Markdown)</Label>
                  <Textarea
                    value={newNote.content}
                    onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                    className="font-mono text-xs min-h-[200px]"
                    placeholder="# 标题&#10;&#10;## 元数据&#10;- 作者: ...&#10;- 年份: ...&#10;&#10;## 核心方法&#10;..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
                <Button onClick={handleAdd}>创建</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">
            <StickyNote className="h-3.5 w-3.5 mr-1.5" />
            笔记列表
          </TabsTrigger>
          <TabsTrigger value="graph">
            <Network className="h-3.5 w-3.5 mr-1.5" />
            知识图谱
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
      {/* Search and filter */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索笔记..." className="pl-8 h-9" />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                <SelectItem value="literature">文献笔记</SelectItem>
                <SelectItem value="project">项目笔记</SelectItem>
                <SelectItem value="knowledge">知识库</SelectItem>
                <SelectItem value="template">模板</SelectItem>
                <SelectItem value="daily">日志</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="h-9 px-3 flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              {filtered.length} 篇
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Note list */}
        <div className="lg:col-span-1 space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {loading ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">加载中...</CardContent></Card>
          ) : filtered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-8 text-center text-sm text-muted-foreground">暂无笔记</CardContent></Card>
          ) : (
            filtered.map((n) => {
              const cat = CATEGORY_LABELS[n.category] ?? CATEGORY_LABELS.literature
              return (
                <Card
                  key={n.id}
                  className={cn('cursor-pointer transition-all hover:shadow-sm', selected?.id === n.id && 'ring-1 ring-primary')}
                  onClick={() => setSelected(n)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className={cn('text-[9px] py-0', cat.color)}>{cat.label}</Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {new Date(n.updatedAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <div className="text-sm font-medium leading-snug line-clamp-2">{n.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.content.replace(/[#*-]/g, '').slice(0, 80)}</div>
                    {n.tags && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {n.tags.split(',').slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline" className="text-[9px] py-0">#{t.trim()}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>

        {/* Note detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <NoteDetail note={selected} onUpdate={(u) => { setSelected(u); refetch() }} onDelete={() => handleDelete(selected)} />
          ) : (
            <Card className="border-dashed h-full">
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                <StickyNote className="h-10 w-10 mx-auto mb-2 opacity-30" />
                点击左侧笔记查看详情
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Obsidian template hint */}
      <Card className="bg-purple-500/5 border-purple-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          💡 <strong>Obsidian 笔记模板</strong>（方法论 §2.2.3）：建议包含元数据/一句话概括/核心方法/关键公式/实验结果/与我的课题关联/疑问与思考。使用 <code className="bg-muted/60 px-1 rounded">[[双链]]</code> 建立文献间关联，方便综述写作时引用。
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="graph">
          <KnowledgeGraph />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function NoteDetail({ note, onUpdate, onDelete }: {
  note: Note
  onUpdate: (n: Note) => void
  onDelete: () => void
}) {
  const api = useApi()
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [tags, setTags] = useState(note.tags)
  const [editing, setEditing] = useState(false)

  const save = async () => {
    try {
      const updated = await api.put(`/api/notes/${note.id}`, { title, content, tags })
      onUpdate({ ...note, title, content, tags, updatedAt: new Date().toISOString() })
      setEditing(false)
      toast.success('已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  // Simple markdown to HTML render (very basic)
  const rendered = renderMarkdown(content)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {editing ? (
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-base font-semibold" />
            ) : (
              <CardTitle className="text-base">{note.title}</CardTitle>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge variant="secondary" className={cn('text-[10px]', CATEGORY_LABELS[note.category]?.color)}>
                {CATEGORY_LABELS[note.category]?.label}
              </Badge>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                更新于 {new Date(note.updatedAt).toLocaleString('zh-CN')}
              </span>
            </div>
          </div>
          <div className="flex gap-1">
            {editing ? (
              <>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setTitle(note.title); setContent(note.content); setTags(note.tags); setEditing(false) }}>取消</Button>
                <Button size="sm" className="h-7 text-xs" onClick={save}>保存</Button>
              </>
            ) : (
              <div className="flex gap-1">
                <NoteTemplates onInsert={(templateContent) => {
                  setEditing(true)
                  setContent(templateContent)
                }} />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}>
                  <Pencil className="h-3 w-3 mr-1" /> 编辑
                </Button>
              </div>
            )}
            <NotesExport note={note} />
            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-2">
            <div>
              <Label className="text-xs">标签</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} className="text-xs" />
            </div>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-xs min-h-[400px]"
            />
          </div>
        ) : (
          <div className="space-y-3">
            {tags && (
              <div className="flex flex-wrap gap-1">
                {tags.split(',').map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    <Tag className="h-2.5 w-2.5 mr-0.5" />
                    {t.trim()}
                  </Badge>
                ))}
              </div>
            )}
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Very simple markdown renderer
function renderMarkdown(md: string): string {
  if (!md) return '<p class="text-muted-foreground">暂无内容</p>'
  let html = md
    // Code blocks
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre class="bg-muted p-3 rounded text-xs overflow-x-auto"><code>${escapeHtml(code.trim())}</code></pre>`)
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-4 mb-2">$1</h1>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-[11px]">$1</code>')
    // Wiki-style links
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="text-primary underline cursor-pointer">$1</span>')
    // Bullets
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Paragraphs
    .split(/\n\n+/)
    .map((p) => p.startsWith('<') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')

  return html
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
