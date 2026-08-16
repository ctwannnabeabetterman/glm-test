'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState, useMemo } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  BookOpen,
  Plus,
  Search,
  Trash2,
  Pencil,
  ExternalLink,
  Github,
  Calendar,
  Trophy,
  Download,
  FileText,
  FileCode,
  ChevronDown,
  Star,
  Filter,
  ListChecks,
  TrendingUp,
  CheckCircle2,
  Copy,
  Network,
  GitBranch,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AISummary } from '@/components/ai-summary'
import { ReadingTimer } from '@/components/reading-timer'
import { PaperRelations } from '@/components/paper-relations'
import { CitationTracker } from '@/components/citation-tracker'

interface Paper {
  id: string
  title: string
  authors: string
  venue: string
  year: number
  citations: number
  relevance: number
  novelty: number
  priority: string
  status: string
  codeUrl: string
  pdfUrl: string
  tags: string
  category: string
  notes: string
  readingProgress: string
  readingTime: number
  dateAdded: string
  dateRead: string | null
}

// Three-pass reading method (§2.3.1)
type ReadingProgress = {
  pass1?: boolean
  pass2?: boolean
  pass3?: boolean
  pass1Notes?: string
  pass2Notes?: string
  pass3Notes?: string
}

function parseReadingProgress(s: string | undefined | null): ReadingProgress {
  if (!s) return {}
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }
const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  unread: { label: '未读', color: 'text-amber-700', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  reading: { label: '阅读中', color: 'text-blue-700', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  read: { label: '已读', color: 'text-emerald-700', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
}
const CATEGORY_LABELS: Record<string, string> = {
  survey: '综述',
  baseline: '基线',
  method: '方法',
  application: '应用',
  '': '其他',
}

export function PapersSection() {
  const { data: papers, loading, refetch } = useFetch<Paper[]>('/api/papers')
  const api = useApi()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newPaper, setNewPaper] = useState<Partial<Paper>>({
    title: '',
    authors: '',
    venue: '',
    year: 2024,
    priority: 'medium',
    status: 'unread',
    category: 'method',
    tags: '',
    relevance: 5,
    novelty: 5,
  })

  const filtered = useMemo(() => {
    if (!papers) return []
    return papers.filter((p) => {
      if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.authors.toLowerCase().includes(search.toLowerCase())) return false
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
      if (priorityFilter !== 'all' && p.priority !== priorityFilter) return false
      return true
    })
  }, [papers, search, statusFilter, categoryFilter, priorityFilter])

  // Compute priority rank (relevance*0.4 + novelty*0.3 + code*15 + year_bonus*0.5)
  const ranked = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const sa = a.relevance * 0.4 + a.novelty * 0.3 + (a.codeUrl ? 15 : 0) + Math.min(a.year - 2019, 5) * 0.5 + PRIORITY_RANK[a.priority as keyof typeof PRIORITY_RANK] * 2
      const sb = b.relevance * 0.4 + b.novelty * 0.3 + (b.codeUrl ? 15 : 0) + Math.min(b.year - 2019, 5) * 0.5 + PRIORITY_RANK[b.priority as keyof typeof PRIORITY_RANK] * 2
      return sb - sa
    })
  }, [filtered])

  const handleStatusChange = async (paper: Paper, status: string) => {
    try {
      await api.put(`/api/papers/${paper.id}`, { status })
      toast.success(`已更新为「${STATUS_LABELS[status]?.label}」`)
      refetch()
      if (selectedPaper?.id === paper.id) {
        setSelectedPaper({ ...paper, status })
      }
    } catch {
      toast.error('更新失败')
    }
  }

  const handleDelete = async (paper: Paper) => {
    if (!confirm(`确认删除「${paper.title}」？`)) return
    try {
      await api.del(`/api/papers/${paper.id}`)
      toast.success('已删除')
      if (selectedPaper?.id === paper.id) setSelectedPaper(null)
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleAdd = async () => {
    if (!newPaper.title?.trim()) {
      toast.error('请填写论文标题')
      return
    }
    try {
      await api.post('/api/papers', newPaper)
      toast.success('已添加论文')
      setAddOpen(false)
      setNewPaper({ title: '', authors: '', venue: '', year: 2024, priority: 'medium', status: 'unread', category: 'method', tags: '', relevance: 5, novelty: 5 })
      refetch()
    } catch {
      toast.error('添加失败')
    }
  }

  const handleExport = (format: 'csv' | 'endnote' | 'bibtex') => {
    const url = `/api/export-papers?format=${format}`
    const a = document.createElement('a')
    a.href = url
    a.download = `papers-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : format === 'endnote' ? 'ris' : 'bib'}`
    a.click()
    toast.success(`已导出 ${format === 'csv' ? 'CSV' : format === 'endnote' ? 'EndNote/RIS' : 'BibTeX'} 格式`)
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="论文库"
        desc="Zotero 风格的文献管理 + 阅读进度追踪 + 优先级排序"
        icon={BookOpen}
        action={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Download className="h-4 w-4 mr-1" />
                  导出
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>选择导出格式</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleExport('csv')}>
                  <FileText className="h-3.5 w-3.5 mr-2" />
                  CSV (Excel 兼容)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('endnote')}>
                  <FileText className="h-3.5 w-3.5 mr-2" />
                  EndNote / RIS
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('bibtex')}>
                  <FileCode className="h-3.5 w-3.5 mr-2" />
                  BibTeX (.bib)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  添加论文
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>添加论文</DialogTitle>
                <DialogDescription>对应方法论 §1.4.3 基线论文清单</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2 max-h-[60vh] overflow-y-auto">
                <div className="md:col-span-2">
                  <Label>标题 *</Label>
                  <Input value={newPaper.title} onChange={(e) => setNewPaper({ ...newPaper, title: e.target.value })} placeholder="Deep Reinforcement Learning for..." />
                </div>
                <div className="md:col-span-2">
                  <Label>作者</Label>
                  <Input value={newPaper.authors} onChange={(e) => setNewPaper({ ...newPaper, authors: e.target.value })} placeholder="Nasir, Y. S., Guo, D." />
                </div>
                <div>
                  <Label>期刊/会议</Label>
                  <Input value={newPaper.venue} onChange={(e) => setNewPaper({ ...newPaper, venue: e.target.value })} placeholder="IEEE TCOM, 2019" />
                </div>
                <div>
                  <Label>年份</Label>
                  <Input type="number" value={newPaper.year} onChange={(e) => setNewPaper({ ...newPaper, year: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>分类</Label>
                  <Select value={newPaper.category} onValueChange={(v) => setNewPaper({ ...newPaper, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="survey">综述</SelectItem>
                      <SelectItem value="baseline">基线</SelectItem>
                      <SelectItem value="method">方法</SelectItem>
                      <SelectItem value="application">应用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>优先级</Label>
                  <Select value={newPaper.priority} onValueChange={(v) => setNewPaper({ ...newPaper, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">高</SelectItem>
                      <SelectItem value="medium">中</SelectItem>
                      <SelectItem value="low">低</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>相关度 (1-10)</Label>
                  <Input type="number" min="1" max="10" value={newPaper.relevance} onChange={(e) => setNewPaper({ ...newPaper, relevance: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>新颖度 (1-10)</Label>
                  <Input type="number" min="1" max="10" value={newPaper.novelty} onChange={(e) => setNewPaper({ ...newPaper, novelty: Number(e.target.value) })} />
                </div>
                <div className="md:col-span-2">
                  <Label>标签 (逗号分隔)</Label>
                  <Input value={newPaper.tags} onChange={(e) => setNewPaper({ ...newPaper, tags: e.target.value })} placeholder="DRL,资源分配,mmWave" />
                </div>
                <div className="md:col-span-2">
                  <Label>代码 URL</Label>
                  <Input value={newPaper.codeUrl} onChange={(e) => setNewPaper({ ...newPaper, codeUrl: e.target.value })} placeholder="github.com/..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
                <Button onClick={handleAdd}>添加</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索标题或作者..."
                className="pl-8 h-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[120px] h-9">
                <Filter className="h-3.5 w-3.5 mr-1" />
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="unread">未读</SelectItem>
                <SelectItem value="reading">阅读中</SelectItem>
                <SelectItem value="read">已读</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue placeholder="分类" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部分类</SelectItem>
                <SelectItem value="survey">综述</SelectItem>
                <SelectItem value="baseline">基线</SelectItem>
                <SelectItem value="method">方法</SelectItem>
                <SelectItem value="application">应用</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[110px] h-9">
                <SelectValue placeholder="优先级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部优先级</SelectItem>
                <SelectItem value="high">高</SelectItem>
                <SelectItem value="medium">中</SelectItem>
                <SelectItem value="low">低</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="h-9 px-3 flex items-center gap-1">
              <ListChecks className="h-3.5 w-3.5" />
              {filtered.length} 篇
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            论文列表
          </TabsTrigger>
          <TabsTrigger value="ranked">
            <Trophy className="h-3.5 w-3.5 mr-1.5" />
            优先级排序
          </TabsTrigger>
          <TabsTrigger value="relations">
            <Network className="h-3.5 w-3.5 mr-1.5" />
            关系网络
          </TabsTrigger>
          <TabsTrigger value="citations">
            <GitBranch className="h-3.5 w-3.5 mr-1.5" />
            引用追踪
          </TabsTrigger>
          <TabsTrigger value="detail">
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            详情
          </TabsTrigger>
        </TabsList>

        {/* List view */}
        <TabsContent value="list" className="space-y-2">
          {loading ? (
            <SkeletonList />
          ) : filtered.length === 0 ? (
            <EmptyCard text="暂无匹配论文，点击右上角添加" />
          ) : (
            <div className="grid grid-cols-1 gap-2 max-h-[70vh] overflow-y-auto pr-1">
              {filtered.map((p) => (
                <PaperRow
                  key={p.id}
                  paper={p}
                  onSelect={() => setSelectedPaper(p)}
                  onStatusChange={(s) => handleStatusChange(p, s)}
                  onDelete={() => handleDelete(p)}
                  selected={selectedPaper?.id === p.id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Ranked view */}
        <TabsContent value="ranked" className="space-y-2">
          <Card className="bg-muted/30">
            <CardContent className="p-3 text-xs text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              评分公式：相关度 × 0.4 + 新颖度 × 0.3 + 开源代码 × 15 + 年份加成 × 0.5 + 优先级 × 2
              <span className="ml-auto">（方法论 §2.3.4 reading_priority.py）</span>
            </CardContent>
          </Card>
          {loading ? (
            <SkeletonList />
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {ranked.map((p, i) => (
                <PaperRankedRow
                  key={p.id}
                  paper={p}
                  rank={i + 1}
                  score={p.relevance * 0.4 + p.novelty * 0.3 + (p.codeUrl ? 15 : 0) + Math.min(p.year - 2019, 5) * 0.5 + PRIORITY_RANK[p.priority as keyof typeof PRIORITY_RANK] * 2}
                  onSelect={() => setSelectedPaper(p)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Relations view */}
        <TabsContent value="relations">
          <PaperRelations />
        </TabsContent>

        {/* Citations view */}
        <TabsContent value="citations">
          <CitationTracker />
        </TabsContent>

        {/* Detail view */}
        <TabsContent value="detail">
          {selectedPaper ? (
            <PaperDetail paper={selectedPaper} onUpdate={(updated) => { setSelectedPaper(updated); refetch() }} />
          ) : (
            <EmptyCard text="点击左侧列表选择论文查看详情" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PaperRow({ paper, onSelect, onStatusChange, onDelete, selected }: {
  paper: Paper
  onSelect: () => void
  onStatusChange: (s: string) => void
  onDelete: () => void
  selected: boolean
}) {
  const status = STATUS_LABELS[paper.status] ?? STATUS_LABELS.unread
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 transition-all hover:shadow-sm cursor-pointer',
        selected ? 'border-primary ring-1 ring-primary/30' : 'border-border'
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium', status.bg, status.color)}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
              {status.label}
            </span>
            {paper.category && (
              <Badge variant="outline" className="text-[10px] py-0">{CATEGORY_LABELS[paper.category] ?? paper.category}</Badge>
            )}
            {paper.priority === 'high' && (
              <Badge variant="secondary" className="text-[10px] py-0 bg-red-500/15 text-red-600">
                <Star className="h-2.5 w-2.5 mr-0.5 fill-current" />
                高优先
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground">{paper.year}</span>
          </div>
          <div className="text-sm font-medium leading-snug line-clamp-2">{paper.title}</div>
          <div className="text-xs text-muted-foreground mt-1 truncate">
            {paper.authors || '未知作者'} · {paper.venue || '未知期刊'}
          </div>
          {paper.tags && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {paper.tags.split(',').slice(0, 4).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground">#{t.trim()}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Select value={paper.status} onValueChange={onStatusChange}>
            <SelectTrigger className="h-7 w-[88px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unread">未读</SelectItem>
              <SelectItem value="reading">阅读中</SelectItem>
              <SelectItem value="read">已读</SelectItem>
            </SelectContent>
          </Select>
          {paper.codeUrl && (
            <a href={paper.codeUrl.startsWith('http') ? paper.codeUrl : `https://${paper.codeUrl}`} target="_blank" rel="noreferrer" className="flex h-7 w-[88px] items-center justify-center gap-1 rounded-md border border-border text-xs hover:bg-muted">
              <Github className="h-3 w-3" /> Code
            </a>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-[88px] text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete}>
            <Trash2 className="h-3 w-3 mr-1" /> 删除
          </Button>
        </div>
      </div>
    </div>
  )
}

function PaperRankedRow({ paper, rank, score, onSelect }: {
  paper: Paper
  rank: number
  score: number
  onSelect: () => void
}) {
  const rankColors = rank === 1 ? 'bg-amber-500 text-white' : rank === 2 ? 'bg-slate-400 text-white' : rank === 3 ? 'bg-orange-700 text-white' : 'bg-muted text-muted-foreground'
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-all hover:shadow-sm cursor-pointer hover:border-primary/40"
      onClick={onSelect}
    >
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-full font-bold text-sm shrink-0', rankColors)}>
        #{rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-snug line-clamp-1">{paper.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {paper.authors} · {paper.venue} · {paper.year}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-xs">
        <div className="text-center">
          <div className="font-bold text-emerald-600">{paper.relevance}</div>
          <div className="text-[9px] text-muted-foreground">相关</div>
        </div>
        <div className="text-center">
          <div className="font-bold text-blue-600">{paper.novelty}</div>
          <div className="text-[9px] text-muted-foreground">新颖</div>
        </div>
        <div className="text-center">
          <div className="font-bold text-amber-600">{paper.citations}</div>
          <div className="text-[9px] text-muted-foreground">引用</div>
        </div>
        <Badge variant="secondary" className="bg-primary/15 text-primary font-bold">
          {score.toFixed(1)}
        </Badge>
      </div>
    </div>
  )
}

function PaperDetail({ paper, onUpdate }: { paper: Paper; onUpdate: (p: Paper) => void }) {
  const api = useApi()
  const [notes, setNotes] = useState(paper.notes)
  const [editing, setEditing] = useState(false)

  const saveNotes = async () => {
    try {
      const updated = await api.put(`/api/papers/${paper.id}`, { notes })
      toast.success('笔记已保存')
      setEditing(false)
      onUpdate({ ...paper, notes })
    } catch {
      toast.error('保存失败')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{paper.title}</CardTitle>
        <CardDescription className="flex items-center gap-2 flex-wrap text-xs">
          <span>{paper.authors}</span>
          <span>·</span>
          <span>{paper.venue}</span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {paper.year}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <DetailStat label="相关度" value={`${paper.relevance}/10`} color="text-emerald-600" />
          <DetailStat label="新颖度" value={`${paper.novelty}/10`} color="text-blue-600" />
          <DetailStat label="引用数" value={paper.citations} color="text-amber-600" />
          <DetailStat label="状态" value={STATUS_LABELS[paper.status]?.label ?? paper.status} color="text-primary" />
        </div>

        {/* Reading timer (§2.3 三遍阅读法) */}
        <ReadingTimer
          paperId={paper.id}
          initialTime={paper.readingTime || 0}
          onTimeUpdate={async (totalSeconds) => {
            try {
              await api.put(`/api/papers/${paper.id}`, { readingTime: totalSeconds })
              onUpdate({ ...paper, readingTime: totalSeconds })
            } catch {
              // Silent fail - localStorage still has the data
            }
          }}
        />

        {/* Three-pass reading tracker (§2.3.1) */}
        <ThreePassReadingTracker paper={paper} onUpdate={onUpdate} />

        {/* AI Summary generator (§2.3.2 精读模板) */}
        <AISummary paper={paper} />

        {/* Citation generator (§4.3.3 BibTeX) */}
        <CitationGenerator paper={paper} />

        {paper.tags && (
          <div>
            <Label className="text-xs">标签</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {paper.tags.split(',').map((t) => (
                <Badge key={t} variant="secondary" className="text-xs">#{t.trim()}</Badge>
              ))}
            </div>
          </div>
        )}

        {paper.codeUrl && (
          <a href={paper.codeUrl.startsWith('http') ? paper.codeUrl : `https://${paper.codeUrl}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <Github className="h-3.5 w-3.5" />
            {paper.codeUrl}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs">阅读笔记 (Markdown)</Label>
            <div className="flex gap-1">
              {editing ? (
                <>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setNotes(paper.notes); setEditing(false) }}>取消</Button>
                  <Button size="sm" className="h-7 text-xs" onClick={saveNotes}>保存</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}>
                  <Pencil className="h-3 w-3 mr-1" /> 编辑
                </Button>
              )}
            </div>
          </div>
          {editing ? (
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="font-mono text-xs min-h-[200px]"
              placeholder="可参考方法论 §2.3.2 论文精读模板..."
            />
          ) : (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap min-h-[80px]">
              {paper.notes || '暂无笔记'}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Three-pass reading method tracker (方法论 §2.3.1)
const PASS_INFO = [
  {
    key: 'pass1' as const,
    title: '第一遍 · 快速筛选',
    duration: '5-10 分钟',
    color: '#3b82f6',
    bgClass: 'bg-blue-500/10 border-blue-500/30',
    icon: '🔍',
    desc: 'Title → Abstract → Conclusion → 扫图表',
    questions: ['研究什么问题？', '用了什么方法？', '结果如何？', '和课题相关吗？'],
    decision: '读 / 不读 / 暂时搁置',
  },
  {
    key: 'pass2' as const,
    title: '第二遍 · 理解框架',
    duration: '30-60 分钟',
    color: '#f59e0b',
    bgClass: 'bg-amber-500/10 border-amber-500/30',
    icon: '📖',
    desc: 'Intro → Method → Experiment(只看图表)',
    questions: ['动机是什么？', '核心思想？', '实验设置合理吗？', '比 baseline 好多少？'],
    decision: '产出: 笔记 + 公式推导',
  },
  {
    key: 'pass3' as const,
    title: '第三遍 · 深度复现',
    duration: '1-2 小时',
    color: '#10b981',
    bgClass: 'bg-emerald-500/10 border-emerald-500/30',
    icon: '🔬',
    desc: '全文精读 + 复现核心实验结果',
    questions: ['公式推导自洽？', '代码实现一致？', '可改进的点？', 'limitation？'],
    decision: '产出: 代码复现仓库 + 改进思路',
  },
]

function ThreePassReadingTracker({ paper, onUpdate }: { paper: Paper; onUpdate: (p: Paper) => void }) {
  const api = useApi()
  const progress = parseReadingProgress(paper.readingProgress)
  const [expandedPass, setExpandedPass] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [editingPass, setEditingPass] = useState<string | null>(null)

  const completedCount = PASS_INFO.filter((p) => progress[p.key]).length
  const overallPct = (completedCount / 3) * 100

  const togglePass = async (passKey: 'pass1' | 'pass2' | 'pass3') => {
    const newProgress = { ...progress, [passKey]: !progress[passKey] }
    const updated = { ...paper, readingProgress: JSON.stringify(newProgress) }
    try {
      await api.put(`/api/papers/${paper.id}`, { readingProgress: JSON.stringify(newProgress) })
      onUpdate(updated)
      // Auto-update paper status based on reading progress
      if (newProgress.pass3) {
        await api.put(`/api/papers/${paper.id}`, { status: 'read' })
        onUpdate({ ...updated, status: 'read' })
      } else if (newProgress.pass1 || newProgress.pass2) {
        await api.put(`/api/papers/${paper.id}`, { status: 'reading' })
        onUpdate({ ...updated, status: 'reading' })
      }
    } catch {
      toast.error('更新失败')
    }
  }

  const savePassNotes = async (passKey: 'pass1' | 'pass2' | 'pass3') => {
    const notesKey = `${passKey}Notes` as keyof ReadingProgress
    const newProgress = { ...progress, [notesKey]: notesDraft[passKey] ?? progress[notesKey] ?? '' }
    const updated = { ...paper, readingProgress: JSON.stringify(newProgress) }
    try {
      await api.put(`/api/papers/${paper.id}`, { readingProgress: JSON.stringify(newProgress) })
      onUpdate(updated)
      setEditingPass(null)
      toast.success('笔记已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <span>📚</span>
            三遍阅读法进度
          </div>
          <div className="text-[10px] text-muted-foreground">方法论 §2.3.1 三遍阅读法</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] text-muted-foreground">{completedCount}/3 完成</div>
          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${overallPct}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {PASS_INFO.map((p) => {
          const isDone = !!progress[p.key]
          const isExpanded = expandedPass === p.key
          const passNotesKey = `${p.key}Notes` as keyof ReadingProgress
          const passNotes = (progress[passNotesKey] as string) || ''
          return (
            <div
              key={p.key}
              className={cn(
                'rounded-md border p-2.5 transition-all cursor-pointer',
                p.bgClass,
                isDone && 'ring-1 ring-offset-1 ring-offset-background',
                isExpanded && 'md:col-span-3'
              )}
              style={isDone ? { borderColor: p.color, boxShadow: `0 0 0 1px ${p.color}40` } : {}}
              onClick={() => setExpandedPass(isExpanded ? null : p.key)}
            >
              <div className="flex items-start gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); togglePass(p.key) }}
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                    isDone ? 'text-white' : 'border-muted-foreground/30 bg-background'
                  )}
                  style={isDone ? { background: p.color, borderColor: p.color } : {}}
                >
                  {isDone && <span className="text-[10px]">✓</span>}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium">{p.title}</span>
                    <span className="text-[9px]">{p.icon}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{p.duration}</div>
                  <div className="text-[10px] text-muted-foreground/80 mt-1">{p.desc}</div>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-border/40 space-y-2 animate-fade-in">
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground mb-1">需要回答的问题：</div>
                    <ul className="space-y-0.5">
                      {p.questions.map((q, i) => (
                        <li key={i} className="text-[10px] flex items-start gap-1">
                          <span style={{ color: p.color }}>•</span>
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground mb-1">产出：{p.decision}</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] font-medium text-muted-foreground">阅读笔记：</div>
                      {editingPass === p.key ? (
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingPass(null); setNotesDraft({}) }}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >取消</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); savePassNotes(p.key) }}
                            className="text-[10px] text-primary hover:underline"
                          >保存</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingPass(p.key); setNotesDraft({ ...notesDraft, [p.key]: passNotes }) }}
                          className="text-[10px] text-primary hover:underline"
                        >编辑</button>
                      )}
                    </div>
                    {editingPass === p.key ? (
                      <Textarea
                        value={notesDraft[p.key] ?? ''}
                        onChange={(e) => setNotesDraft({ ...notesDraft, [p.key]: e.target.value })}
                        className="text-xs min-h-[80px]"
                        placeholder={`记录第${p.key === 'pass1' ? '一' : p.key === 'pass2' ? '二' : '三'}遍阅读的发现...`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="rounded bg-background/60 p-2 text-[10px] whitespace-pre-wrap min-h-[40px] border border-border/30">
                        {passNotes || <span className="text-muted-foreground">暂无笔记</span>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============ Citation Generator (BibTeX) ============
// 方法论 §4.3.3 BibTeX 文献管理
function generateBibtexKey(paper: Paper): string {
  // Format: author_lastname + year + first_2_words_of_title
  const firstAuthor = (paper.authors || 'unknown').split(',')[0].trim().split(' ').pop()?.toLowerCase() || 'unknown'
  const titleWords = paper.title.split(/\s+/).filter((w) => !/^(the|a|an|for|of|in|on|with|and|to)$/i.test(w)).slice(0, 2).join('').toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${firstAuthor}${paper.year}${titleWords}`
}

function generateBibtex(paper: Paper): { type: string; key: string; content: string } {
  const key = generateBibtexKey(paper)
  const venue = paper.venue || ''

  // Determine entry type based on venue
  const isJournal = /journal|transactions|letters|TCOM|TWC|TVT|CL|ACCESS|COMST/i.test(venue)
  const isConference = /conference|ICC|GLOBECOM|WCNC|VTC|INFOCOM|workshop|symposium/i.test(venue)

  let entryType = 'misc'
  if (isJournal) entryType = 'article'
  else if (isConference) entryType = 'inproceedings'

  // Parse venue to extract journal/conference name and year
  const venueMatch = venue.match(/^(.+?),\s*(\d{4})$/)
  const venueName = venueMatch ? venueMatch[1].trim() : venue
  const year = venueMatch ? venueMatch[2] : String(paper.year)

  // Parse authors - BibTeX uses " and " between authors
  const authors = paper.authors || 'Unknown'

  const fields: string[] = [
    `  title     = {{{${paper.title}}}},`,
    `  author    = {${authors}},`,
    `  year      = {${year}},`,
  ]

  if (entryType === 'article') {
    fields.push(`  journal   = {${venueName}},`)
  } else if (entryType === 'inproceedings') {
    fields.push(`  booktitle = {${venueName}},`)
  } else {
    fields.push(`  howpublished = {${venueName}},`)
  }

  if (paper.citations > 0) {
    fields.push(`  note      = {Citations: ${paper.citations}},`)
  }

  if (paper.codeUrl) {
    fields.push(`  url       = {${paper.codeUrl.startsWith('http') ? paper.codeUrl : `https://${paper.codeUrl}`}},`)
  }

  const content = `@${entryType}{${key},\n${fields.join('\n')}\n}`
  return { type: entryType, key, content }
}

function CitationGenerator({ paper }: { paper: Paper }) {
  const [copied, setCopied] = useState(false)
  const [showCitation, setShowCitation] = useState(false)
  const { type, key, content } = generateBibtex(paper)

  const copy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    toast.success('BibTeX 已复制到剪贴板')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <span>📑</span>
            BibTeX 引用
          </div>
          <div className="text-[10px] text-muted-foreground">方法论 §4.3.3 BibTeX 文献管理</div>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCitation(!showCitation)}>
          {showCitation ? '收起' : '展开'}
        </Button>
      </div>

      {showCitation && (
        <div className="space-y-2 animate-fade-in">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-[10px] bg-purple-500/15 text-purple-600">
              @{type}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono">{key}</Badge>
          </div>
          <pre className="rounded-md bg-background/80 border border-border/40 p-2.5 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
            {content}
          </pre>
          <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={copy}>
            {copied ? (
              <><CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" /> 已复制</>
            ) : (
              <><Copy className="h-3 w-3 mr-1" /> 复制 BibTeX</>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

function DetailStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2.5">
      <div className={cn('text-lg font-bold', color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="rounded-lg border border-border p-3 animate-pulse">
          <div className="h-3 bg-muted rounded w-1/3 mb-2" />
          <div className="h-4 bg-muted rounded w-3/4 mb-1" />
          <div className="h-3 bg-muted rounded w-1/2" />
        </div>
      ))}
    </div>
  )
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {text}
      </CardContent>
    </Card>
  )
}

function SectionHeader({ title, desc, icon: Icon, action }: {
  title: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

export { SectionHeader }
