'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { SectionHeader, PanelHeader, MethodNote } from '@/components/section-header'
import { FullTextSearch } from '@/components/full-text-search'
import { AIRelatedPapers } from '@/components/ai-related-papers'
import {
  Search,
  Plus,
  Trash2,
  Copy,
  RefreshCw,
  ExternalLink,
  FileText,
  Network,
  GitBranch,
  ArrowDownRight,
  ArrowUpRight,
  Database,
  Calendar,
  Table as TableIcon,
  Download,
  Code,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { KEYWORDS } from '@/lib/methodology-data'

interface Keyword {
  id: string
  text: string
  dimension: string
}

interface SearchLog {
  id: string
  database: string
  query: string
  resultsCount: number
  keptCount: number
  notes: string
  createdAt: string
}

/* 三个维度用「实心 / 半透明 / 空心」圆点区分，不再用绿/琥珀/红三色（红色保留给危险操作） */
const DIMENSION_LABELS: Record<string, { label: string; dot: string; chip: string }> = {
  scenario: { label: '通信场景', dot: 'bg-primary', chip: 'border-primary/40 bg-primary/10 text-primary' },
  method: { label: 'AI 方法', dot: 'bg-primary/45', chip: 'border-primary/30 bg-accent text-accent-foreground' },
  problem: { label: '通信子问题', dot: 'border border-primary bg-transparent', chip: 'border-border bg-muted text-foreground' },
}


export function SearchSection() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="文献检索工具"
        desc="关键词矩阵 · 检索式构建 · arXiv 监控 · 雪球法 · 检索记录"
        icon={Search}
      />

      <Tabs defaultValue="matrix">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="ai-recommend">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            AI 推荐
          </TabsTrigger>
          <TabsTrigger value="matrix">
            <Network className="h-3.5 w-3.5 mr-1.5" />
            关键词矩阵
          </TabsTrigger>
          <TabsTrigger value="query">
            <Search className="h-3.5 w-3.5 mr-1.5" />
            检索式构建
          </TabsTrigger>
          <TabsTrigger value="arxiv">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            arXiv 监控
          </TabsTrigger>
          <TabsTrigger value="snowball">
            <GitBranch className="h-3.5 w-3.5 mr-1.5" />
            雪球法
          </TabsTrigger>
          <TabsTrigger value="comparison">
            <TableIcon className="h-3.5 w-3.5 mr-1.5" />
            对比表生成
          </TabsTrigger>
          <TabsTrigger value="fulltext">
            <Search className="h-3.5 w-3.5 mr-1.5" />
            全文搜索
          </TabsTrigger>
          <TabsTrigger value="logs">
            <Database className="h-3.5 w-3.5 mr-1.5" />
            检索记录
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai-recommend"><AIRelatedPapers /></TabsContent>
        <TabsContent value="matrix"><KeywordMatrix /></TabsContent>
        <TabsContent value="query"><QueryBuilder /></TabsContent>
        <TabsContent value="arxiv"><ArxivMonitor /></TabsContent>
        <TabsContent value="snowball"><SnowballMethod /></TabsContent>
        <TabsContent value="comparison"><ComparisonTableGenerator /></TabsContent>
        <TabsContent value="fulltext"><FullTextSearch /></TabsContent>
        <TabsContent value="logs"><SearchLogs /></TabsContent>
      </Tabs>
    </div>
  )
}

// ============ 关键词矩阵 ============
function KeywordMatrix() {
  const { data: dbKeywords, refetch } = useFetch<Keyword[]>('/api/keywords')
  const api = useApi()
  const [addDialog, setAddDialog] = useState<{ open: boolean; dim: string }>({ open: false, dim: 'scenario' })
  const [newText, setNewText] = useState('')

  // Merge DB keywords with defaults
  const grouped = useMemo(() => {
    const result: Record<string, string[]> = {
      scenario: [...KEYWORDS.scenario],
      method: [...KEYWORDS.method],
      problem: [...KEYWORDS.problem],
    }
    dbKeywords?.forEach((k) => {
      if (result[k.dimension] && !result[k.dimension].includes(k.text)) {
        result[k.dimension].push(k.text)
      }
    })
    return result
  }, [dbKeywords])

  const [selected, setSelected] = useState<{ scenario?: string; method?: string; problem?: string }>({})

  const handleAdd = async () => {
    if (!newText.trim()) return
    try {
      await api.post('/api/keywords', { text: newText.trim(), dimension: addDialog.dim })
      toast.success('关键词已添加')
      setNewText('')
      setAddDialog({ open: false, dim: 'scenario' })
      refetch()
    } catch {
      toast.error('添加失败')
    }
  }

  const handleDelete = async (text: string, dim: string) => {
    const k = dbKeywords?.find((kw) => kw.text === text && kw.dimension === dim)
    if (k) {
      try {
        await api.del(`/api/keywords?id=${k.id}`)
        toast.success('已删除')
        refetch()
      } catch {
        toast.error('删除失败')
      }
    } else {
      toast.info('该关键词为默认预设，无法删除')
    }
  }

  const totalCombos = grouped.scenario.length * grouped.method.length * grouped.problem.length

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <Card className="border-l-2 border-l-primary/60 bg-card py-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="eyebrow mb-1">三维关键词矩阵（方法论 §1.2.1）</div>
              <div className="tabular font-mono text-2xl font-semibold tracking-tight">
                {grouped.scenario.length} × {grouped.method.length} × {grouped.problem.length}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">共 <span className="tabular text-foreground">{totalCombos}</span> 种检索组合</div>
            </div>
            <div className="text-xs text-muted-foreground max-w-md">
              💡 建议每周从矩阵中选 2-3 个组合，在 IEEE Xplore / arXiv 上检索，扫读最新结果
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {(['scenario', 'method', 'problem'] as const).map((dim) => (
          <Card key={dim}>
            <PanelHeader
              title={
                <>
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DIMENSION_LABELS[dim].dot)} aria-hidden="true" />
                  {DIMENSION_LABELS[dim].label}
                </>
              }
              action={
                <>
                  <Badge variant="outline" className="tabular rounded-sm text-[11px] font-normal">{grouped[dim].length}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    aria-label={`添加${DIMENSION_LABELS[dim].label}关键词`}
                    onClick={() => { setAddDialog({ open: true, dim }); setNewText('') }}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </>
              }
            />
            <CardContent className="pt-0">
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {grouped[dim].map((kw) => {
                  const isSelected = selected[dim] === kw
                  const isCustom = !!dbKeywords?.find((k) => k.text === kw && k.dimension === dim)
                  return (
                    <div
                      key={kw}
                      className={cn(
                        'list-row card-hover group flex items-center justify-between gap-2 px-2 py-1.5 text-xs cursor-pointer',
                        isSelected && 'border-primary bg-primary/10 text-primary font-medium'
                      )}
                      onClick={() => setSelected({ ...selected, [dim]: isSelected ? undefined : kw })}
                    >
                      {/* 行内有删除按钮 ⇒ 外层保持 div；关键词本身用无处理器的 button，click 冒泡到外层 */}
                      <button type="button" aria-pressed={isSelected} className="min-w-0 flex-1 truncate rounded-sm text-left">
                        {kw}
                      </button>
                      {isCustom && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDelete(kw, dim) }}
                          aria-label={`删除关键词 ${kw}`}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Selected combination preview */}
      <Card>
        <PanelHeader title="已选组合" />
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Badge variant="outline" className={cn('rounded-sm font-normal', DIMENSION_LABELS.scenario.chip)}>
              {selected.scenario ?? '— 场景 —'}
            </Badge>
            <span className="text-muted-foreground" aria-hidden="true">×</span>
            <Badge variant="outline" className={cn('rounded-sm font-normal', DIMENSION_LABELS.method.chip)}>
              {selected.method ?? '— 方法 —'}
            </Badge>
            <span className="text-muted-foreground" aria-hidden="true">×</span>
            <Badge variant="outline" className={cn('rounded-sm font-normal', DIMENSION_LABELS.problem.chip)}>
              {selected.problem ?? '— 问题 —'}
            </Badge>
          </div>
          {selected.scenario && selected.method && selected.problem ? (
            <div className="space-y-2">
              <div className="rounded-sm border border-border bg-muted p-3 font-mono text-xs break-all">
                {`("${selected.scenario}") AND ("${selected.method}") AND ("${selected.problem}")`}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => {
                  const q = `("${selected.scenario}") AND ("${selected.method}") AND ("${selected.problem}")`
                  navigator.clipboard.writeText(q)
                  toast.success('检索式已复制')
                }}>
                  <Copy className="h-3 w-3 mr-1" /> 复制检索式
                </Button>
                <a
                  href={`https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${encodeURIComponent(`("${selected.scenario}") AND ("${selected.method}") AND ("${selected.problem}")`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" /> 在 IEEE Xplore 中打开
                </a>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">从上方矩阵中选择三个维度的关键词，自动生成 IEEE Xplore 兼容检索式</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addDialog.open} onOpenChange={(o) => setAddDialog({ ...addDialog, open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加关键词 · {DIMENSION_LABELS[addDialog.dim]?.label}</DialogTitle>
          </DialogHeader>
          <Input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="例如：massive MIMO, DRL, channel estimation"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog({ open: false, dim: 'scenario' })}>取消</Button>
            <Button onClick={handleAdd}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============ 检索式构建器 ============
function QueryBuilder() {
  const [groups, setGroups] = useState<{ name: string; keywords: string[] }[]>([
    { name: 'scenario', keywords: ['mmWave', 'millimeter wave'] },
    { name: 'method', keywords: ['deep Q-network', 'DQN', 'PPO'] },
    { name: 'problem', keywords: ['resource allocation', 'power control'] },
  ])
  const [newGroup, setNewGroup] = useState('')
  const [newKw, setNewKw] = useState<{ [group: string]: string }>({})

  const query = useMemo(() => {
    return groups
      .filter((g) => g.keywords.length > 0)
      .map((g) => `(${g.keywords.map((k) => `"${k}"`).join(' OR ')})`)
      .join(' AND ')
  }, [groups])

  const addGroup = () => {
    if (!newGroup.trim()) return
    setGroups([...groups, { name: newGroup.trim(), keywords: [] }])
    setNewGroup('')
  }

  const addKw = (gName: string) => {
    const kw = newKw[gName]?.trim()
    if (!kw) return
    setGroups(groups.map((g) => g.name === gName ? { ...g, keywords: [...g.keywords, kw] } : g))
    setNewKw({ ...newKw, [gName]: '' })
  }

  const removeKw = (gName: string, kw: string) => {
    setGroups(groups.map((g) => g.name === gName ? { ...g, keywords: g.keywords.filter((k) => k !== kw) } : g))
  }

  const removeGroup = (gName: string) => {
    setGroups(groups.filter((g) => g.name !== gName))
  }

  return (
    <div className="space-y-4">
      <MethodNote>
        <strong>三层递进检索策略</strong>（方法论 §2.1.2）
        <ul className="mt-1 ml-4 space-y-0.5 list-disc">
          <li>第一层：宽泛检索（找综述）</li>
          <li>第二层：精准检索（定位核心论文）</li>
          <li>第三层：追溯检索（扩展引用网络）</li>
        </ul>
      </MethodNote>

      <div className="space-y-3">
        {groups.map((g) => (
          <Card key={g.name}>
            <PanelHeader
              as="h3"
              title={
                <>
                  <span className="rounded-sm bg-accent px-2 py-0.5 text-xs font-mono text-accent-foreground">{g.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    <span className="tabular">{g.keywords.length}</span> 关键词 · OR 连接
                  </span>
                </>
              }
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  aria-label={`删除关键词组 ${g.name}`}
                  onClick={() => removeGroup(g.name)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              }
            />
            <CardContent className="pt-0 space-y-2">
              <div className="flex flex-wrap gap-1">
                {g.keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="rounded-sm text-xs font-normal gap-1 pr-1">
                    "{kw}"
                    <button
                      type="button"
                      onClick={() => removeKw(g.name, kw)}
                      aria-label={`移除 ${kw}`}
                      className="rounded-sm hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </Badge>
                ))}
                {g.keywords.length === 0 && (
                  <span className="text-xs text-muted-foreground">暂无关键词</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newKw[g.name] || ''}
                  onChange={(e) => setNewKw({ ...newKw, [g.name]: e.target.value })}
                  placeholder={`添加到 ${g.name}...`}
                  className="h-8 text-xs"
                  onKeyDown={(e) => e.key === 'Enter' && addKw(g.name)}
                />
                <Button size="sm" variant="outline" className="h-8" aria-label={`添加关键词到 ${g.name}`} onClick={() => addKw(g.name)}>
                  <Plus className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          placeholder="新增关键词组（如：dataset, year...）"
          className="h-9"
          onKeyDown={(e) => e.key === 'Enter' && addGroup()}
        />
        <Button variant="outline" onClick={addGroup}>
          <Plus className="h-3.5 w-3.5 mr-1" /> 新增组
        </Button>
      </div>

      <Card>
        <PanelHeader title="生成检索式" description="组间用 AND 连接，组内用 OR 连接" />
        <CardContent>
          <div className="rounded-sm border border-border bg-muted p-3 font-mono text-xs break-all min-h-[60px]">
            {query || '— 暂无 —'}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(query); toast.success('已复制') }} disabled={!query}>
              <Copy className="h-3 w-3 mr-1" /> 复制
            </Button>
            <a
              href={`https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${encodeURIComponent(query)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" /> IEEE Xplore
            </a>
            <a
              href={`https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" /> Google Scholar
            </a>
            <a
              href={`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=20`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" /> arXiv
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============ arXiv 监控 ============
function ArxivMonitor() {
  const [query, setQuery] = useState('deep reinforcement learning resource allocation wireless')
  const [daysBack, setDaysBack] = useState(30)
  const [maxResults, setMaxResults] = useState(10)
  const [results, setResults] = useState<ArxivPaper[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(async () => {
    setLoading(true)
    try {
      const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`
      const res = await fetch(url)
      const xml = await res.text()
      // Parse XML
      const parser = new DOMParser()
      const doc = parser.parseFromString(xml, 'text/xml')
      const entries = Array.from(doc.querySelectorAll('entry')).map((entry) => {
        const get = (tag: string) => entry.querySelector(tag)?.textContent?.replace(/\s+/g, ' ').trim() || ''
        return {
          title: get('title'),
          summary: get('summary').slice(0, 300),
          published: get('published').slice(0, 10),
          link: get('id'),
          authors: Array.from(entry.querySelectorAll('author > name')).map((a) => a.textContent).join(', '),
        }
      })
      setResults(entries)
      toast.success(`找到 ${entries.length} 篇论文`)
    } catch (e) {
      toast.error('arXiv 检索失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [query, maxResults])

  return (
    <div className="space-y-4">
      <MethodNote>
        <strong>📡 arXiv 监控</strong>
        （方法论 §1.2.4 arxiv_monitor.py）—— 每周一早上运行，生成本周新论文报告，花 30 分钟扫读标题+摘要
      </MethodNote>

      <Card>
        <CardContent className="p-3 space-y-2">
          <div>
            <Label className="text-xs">检索关键词</Label>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">最大结果数</Label>
              <Input type="number" value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">回溯天数（参考）</Label>
              <Input type="number" value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value))} className="mt-1" />
            </div>
          </div>
          <Button onClick={search} disabled={loading} className="w-full">
            {loading ? <><RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> 检索中...</> : <><Search className="h-3.5 w-3.5 mr-1" /> 检索 arXiv</>}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {results.map((p, i) => (
            <article key={i} className="list-row card-hover p-3">
              <div className="flex items-start gap-2 mb-1.5">
                <Badge variant="outline" className="tabular rounded-sm text-[11px] font-mono font-normal border-primary/30 bg-accent text-accent-foreground shrink-0">
                  {p.published}
                </Badge>
                <h3 className="text-sm font-medium leading-snug flex-1">{p.title}</h3>
              </div>
              <div className="text-xs text-muted-foreground mb-2">{p.authors}</div>
              <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2 mb-2">{p.summary}...</p>
              <a href={p.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" aria-hidden="true" /> 查看原文
              </a>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

interface ArxivPaper {
  title: string
  summary: string
  published: string
  link: string
  authors: string
}

// ============ 雪球法 ============
function SnowballMethod() {
  const [seedPaper, setSeedPaper] = useState('Deep Reinforcement Learning for Resource Allocation in Wireless Networks')
  const [tree, setTree] = useState<{ newer: string[]; foundational: string[] } | null>(null)

  const sampleTree = {
    newer: [
      'Multi-Agent DRL for Spectrum Access (2021)',
      'DRL for 5G Network Slicing (2022)',
      'Attention-based DRL Resource Allocation (2023)',
      'Federated DRL for Resource Management (2023)',
    ],
    foundational: [
      'Resource Allocation in Wireless Networks (2005)',
      'Reinforcement Learning: An Introduction (Sutton 1998)',
      'WMMSE Power Control (2011)',
    ],
  }

  const build = () => {
    setTree(sampleTree)
    toast.success('已构建文献树（示例数据）')
  }

  return (
    <div className="space-y-4">
      <MethodNote>
        <strong>文献雪球法</strong>
        （方法论 §1.2.5 + §2.1.3）—— 从核心论文出发，向两个方向扩展引用网络
      </MethodNote>

      <Card>
        <CardContent className="p-3 space-y-2">
          <Label className="text-xs">种子论文</Label>
          <Input value={seedPaper} onChange={(e) => setSeedPaper(e.target.value)} />
          <Button onClick={build} className="w-full">
            <GitBranch className="h-3.5 w-3.5 mr-1" /> 构建文献树
          </Button>
        </CardContent>
      </Card>

      {tree && (
        <div className="space-y-4">
          {/* Tree visualization */}
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col items-center gap-4">
                {/* Seed */}
                <div className="rounded-md border-2 border-primary bg-primary/10 px-4 py-2 text-center max-w-md">
                  <div className="text-[11px] text-primary font-semibold mb-0.5">🌱 种子论文</div>
                  <div className="text-xs font-medium">{seedPaper}</div>
                </div>

                {/* Two branches */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                  {/* Forward snowball (newer) */}
                  <div className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-medium text-primary">
                      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                      向后雪球（最新进展）
                    </h3>
                    <div className="text-[11px] text-muted-foreground ml-6">查看谁引用了它</div>
                    {/* 原为 cursor-pointer 的 div 但没有点击处理 ⇒ 去掉误导性的指针样式，保留为静态条目 */}
                    {tree.newer.map((p, i) => (
                      <div key={i} className="list-row p-2 text-xs">
                        <div className="flex items-start gap-1.5">
                          <span className="text-primary mt-0.5" aria-hidden="true">→</span>
                          <span>{p}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Backward snowball (foundational) */}
                  <div className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <ArrowDownRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      向前雪球（理论基础）
                    </h3>
                    <div className="text-[11px] text-muted-foreground ml-6">查看它引用的论文</div>
                    {tree.foundational.map((p, i) => (
                      <div key={i} className="list-row p-2 text-xs">
                        <div className="flex items-start gap-1.5">
                          <span className="text-muted-foreground mt-0.5" aria-hidden="true">←</span>
                          <span>{p}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3 text-xs text-muted-foreground">
              💡 <strong>提示</strong>：实际使用时，可在 Google Scholar 中点击 "Cited by" 进行向后雪球；
              在论文 References 部分进行向前雪球。重点关注近 2 年高被引论文和被多次引用的经典论文。
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// ============ 检索记录 ============
function SearchLogs() {
  const { data: logs, refetch } = useFetch<SearchLog[]>('/api/search-logs')
  const api = useApi()
  const [addOpen, setAddOpen] = useState(false)
  const [newLog, setNewLog] = useState<Partial<SearchLog>>({
    database: 'IEEE Xplore',
    query: '',
    resultsCount: 0,
    keptCount: 0,
    notes: '',
  })

  const handleAdd = async () => {
    if (!newLog.query?.trim()) return
    try {
      await api.post('/api/search-logs', newLog)
      toast.success('检索记录已保存')
      setAddOpen(false)
      setNewLog({ database: 'IEEE Xplore', query: '', resultsCount: 0, keptCount: 0, notes: '' })
      refetch()
    } catch {
      toast.error('保存失败')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.del(`/api/search-logs/${id}`)
      toast.success('已删除')
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <MethodNote
        action={
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> 新增记录
          </Button>
        }
      >
        <strong>检索记录卡</strong>
        （方法论 §2.1.2）—— 记录每次检索的数据库、检索式、结果数和收获，便于复盘
      </MethodNote>

      {!logs || logs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            暂无检索记录
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="list-row p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-sm text-xs font-normal border-primary/30 bg-accent text-accent-foreground">
                    <Database className="h-3 w-3 mr-1" aria-hidden="true" />
                    {log.database}
                  </Badge>
                  <span className="tabular text-[11px] text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden="true" />
                    {new Date(log.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  aria-label="删除这条检索记录"
                  onClick={() => handleDelete(log.id)}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
              <div className="rounded-sm border border-border bg-muted p-2 font-mono text-xs break-all mb-2">{log.query}</div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>结果数: <strong className="tabular text-foreground">{log.resultsCount}</strong></span>
                <span>保留: <strong className="tabular text-primary">{log.keptCount}</strong></span>
                <span>保留率: <span className="tabular">{log.resultsCount > 0 ? ((log.keptCount / log.resultsCount) * 100).toFixed(0) : 0}%</span></span>
              </div>
              {log.notes && (
                <div className="text-xs leading-relaxed text-muted-foreground mt-2 pt-2 border-t border-border">{log.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增检索记录</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">数据库</Label>
              <Select value={newLog.database} onValueChange={(v) => setNewLog({ ...newLog, database: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IEEE Xplore">IEEE Xplore</SelectItem>
                  <SelectItem value="arXiv">arXiv</SelectItem>
                  <SelectItem value="Google Scholar">Google Scholar</SelectItem>
                  <SelectItem value="Semantic Scholar">Semantic Scholar</SelectItem>
                  <SelectItem value="CNKI">CNKI 知网</SelectItem>
                  <SelectItem value="Web of Science">Web of Science</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">检索式</Label>
              <Textarea
                value={newLog.query}
                onChange={(e) => setNewLog({ ...newLog, query: e.target.value })}
                className="font-mono text-xs"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">结果数</Label>
                <Input type="number" value={newLog.resultsCount} onChange={(e) => setNewLog({ ...newLog, resultsCount: Number(e.target.value) })} />
              </div>
              <div>
                <Label className="text-xs">保留数</Label>
                <Input type="number" value={newLog.keptCount} onChange={(e) => setNewLog({ ...newLog, keptCount: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">收获/备注</Label>
              <Textarea
                value={newLog.notes}
                onChange={(e) => setNewLog({ ...newLog, notes: e.target.value })}
                placeholder="发现新关键词，下一步..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={handleAdd}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============ Comparison Table Generator (§2.4.2) ============
interface PaperForComparison {
  id: string
  title: string
  authors: string
  venue: string
  year: number
  category: string
  tags: string
  relevance: number
  novelty: number
  status: string
}

const COMPARISON_COLUMNS = [
  { key: 'method', label: '方法', placeholder: 'LSTM / DRL / GNN', default: '' },
  { key: 'type', label: '类型', placeholder: 'DL / RL / FL', default: '' },
  { key: 'metric', label: '主要指标', placeholder: 'MSE / BER / 吞吐量', default: '' },
  { key: 'result', label: '性能', placeholder: '-18.2 dB / +25%', default: '' },
  { key: 'complexity', label: '复杂度', placeholder: 'O(Ld²)', default: '' },
  { key: 'code', label: '代码', placeholder: '✓ / ✗', default: '✗' },
]

function ComparisonTableGenerator() {
  const { data: papers } = useFetch<PaperForComparison[]>('/api/papers')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [columnValues, setColumnValues] = useState<Record<string, Record<string, string>>>({})
  const [viewMode, setViewMode] = useState<'markdown' | 'latex'>('markdown')

  const togglePaper = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
    if (!columnValues[id]) {
      const init: Record<string, string> = {}
      COMPARISON_COLUMNS.forEach((c) => { init[c.key] = c.default })
      setColumnValues((prev) => ({ ...prev, [id]: init }))
    }
  }

  const updateColumn = (paperId: string, colKey: string, value: string) => {
    setColumnValues((prev) => ({
      ...prev,
      [paperId]: { ...(prev[paperId] || {}), [colKey]: value },
    }))
  }

  const selectedPapers = (papers || []).filter((p) => selectedIds.includes(p.id))

  const generateMarkdown = () => {
    const headers = ['论文', '年份', ...COMPARISON_COLUMNS.map((c) => c.label)]
    const lines = [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
    ]
    for (const p of selectedPapers) {
      const cv = columnValues[p.id] || {}
      const shortTitle = p.title.length > 40 ? p.title.slice(0, 38) + '..' : p.title
      const row = [
        `${shortTitle}`,
        String(p.year),
        ...COMPARISON_COLUMNS.map((c) => cv[c.key] || '-'),
      ]
      lines.push(`| ${row.join(' | ')} |`)
    }
    return lines.join('\n')
  }

  const generateLatex = () => {
    const cols = 'l' + 'c'.repeat(COMPARISON_COLUMNS.length + 1)
    const lines = [
      '\\begin{table}[t]',
      '\\centering',
      '\\caption{Method Comparison}',
      `\\begin{tabular}{${cols}}`,
      '\\toprule',
      `Paper & Year & ${COMPARISON_COLUMNS.map((c) => c.label).join(' & ')} \\\\`,
      '\\midrule',
    ]
    for (const p of selectedPapers) {
      const cv = columnValues[p.id] || {}
      const shortTitle = p.title.length > 30 ? p.title.slice(0, 28) + '..' : p.title
      const row = [
        shortTitle.replace(/&/g, '\\&'),
        String(p.year),
        ...COMPARISON_COLUMNS.map((c) => (cv[c.key] || '-').replace(/&/g, '\\&')),
      ]
      lines.push(`${row.join(' & ')} \\\\`)
    }
    lines.push('\\bottomrule', '\\end{tabular}', '\\end{table}')
    return lines.join('\n')
  }

  const generatedContent = viewMode === 'markdown' ? generateMarkdown() : generateLatex()

  const copy = () => {
    navigator.clipboard.writeText(generatedContent)
    toast.success(`${viewMode === 'markdown' ? 'Markdown' : 'LaTeX'} 表格已复制`)
  }

  const download = () => {
    const ext = viewMode === 'markdown' ? 'md' : 'tex'
    const blob = new Blob([generatedContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `comparison-table.${ext}`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已下载 comparison-table.${ext}`)
  }

  return (
    <div className="space-y-3">
      <MethodNote>
        📊 <strong>文献对比表自动生成</strong>
        （方法论 §2.4.2 comparison_table.py）—— 从论文库选择论文，自动生成 Markdown / LaTeX 对比表
      </MethodNote>

      <Card>
        <PanelHeader
          title={<>① 选择论文（已选 <span className="tabular">{selectedIds.length}</span> 篇）</>}
          description="从论文库中选择要对比的论文"
        />
        <CardContent>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {(papers || []).map((p) => {
              const isSelected = selectedIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePaper(p.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'list-row card-hover flex items-center gap-2 w-full text-left p-2',
                    isSelected && 'border-primary bg-primary/10'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                      isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30'
                    )}
                    aria-hidden="true"
                  >
                    {isSelected && <span className="text-[11px]">✓</span>}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-medium truncate">{p.title}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">{p.authors} · {p.venue}</span>
                  </span>
                  <Badge variant="outline" className="tabular rounded-sm text-[11px] font-normal shrink-0">{p.year}</Badge>
                </button>
              )
            })}
            {(!papers || papers.length === 0) && (
              <div className="text-xs text-muted-foreground text-center py-4">论文库暂无论文</div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedPapers.length > 0 && (
        <Card>
          <PanelHeader title="② 填写对比维度" description="为每篇论文填写方法、类型、性能等对比信息" />
          <CardContent>
            <div className="space-y-2">
              {selectedPapers.map((p) => (
                <div key={p.id} className="list-row p-2.5">
                  <div className="text-xs font-medium mb-2 truncate">{p.title}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {COMPARISON_COLUMNS.map((c) => (
                      <div key={c.key}>
                        <Label className="text-[11px] text-muted-foreground">{c.label}</Label>
                        <Input
                          value={columnValues[p.id]?.[c.key] ?? c.default}
                          onChange={(e) => updateColumn(p.id, c.key, e.target.value)}
                          placeholder={c.placeholder}
                          className="h-7 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedPapers.length > 0 && (
        <Card>
          <PanelHeader
            title="③ 生成结果"
            action={
              <div className="flex gap-1" role="group" aria-label="输出格式">
                <Button
                  size="sm"
                  variant={viewMode === 'markdown' ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  aria-pressed={viewMode === 'markdown'}
                  onClick={() => setViewMode('markdown')}
                >
                  Markdown
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'latex' ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  aria-pressed={viewMode === 'latex'}
                  onClick={() => setViewMode('latex')}
                >
                  <Code className="h-3 w-3 mr-1" aria-hidden="true" /> LaTeX
                </Button>
              </div>
            }
          />
          <CardContent className="space-y-2">
            <pre className="rounded-sm bg-muted/50 border border-border p-3 text-[12px] font-mono overflow-x-auto whitespace-pre">
              {generatedContent}
            </pre>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={copy}>
                <Copy className="h-3 w-3 mr-1" /> 复制
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={download}>
                <Download className="h-3 w-3 mr-1" /> 下载 .{viewMode === 'markdown' ? 'md' : 'tex'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedPapers.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <TableIcon className="h-10 w-10 mx-auto mb-2 opacity-30" aria-hidden="true" />
            从上方选择论文开始生成对比表
          </CardContent>
        </Card>
      )}
    </div>
  )
}
