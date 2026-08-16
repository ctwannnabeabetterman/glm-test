'use client'

import { useState, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, Loader2, BookOpen, Target, StickyNote, FlaskConical, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { toast } from 'sonner'

interface SearchResult {
  id: string
  type: 'paper' | 'topic' | 'note' | 'experiment'
  title: string
  subtitle: string
  meta: string
  tags?: string
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  paper: { label: '论文', icon: BookOpen, color: 'text-emerald-600 bg-emerald-500/10' },
  topic: { label: '课题', icon: Target, color: 'text-amber-600 bg-amber-500/10' },
  note: { label: '笔记', icon: StickyNote, color: 'text-blue-600 bg-blue-500/10' },
  experiment: { label: '实验', icon: FlaskConical, color: 'text-purple-600 bg-purple-500/10' },
}

const NAV_MAP: Record<string, 'papers' | 'topics' | 'notes' | 'experiments'> = {
  paper: 'papers',
  topic: 'topics',
  note: 'notes',
  experiment: 'experiments',
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const parts = text.split(new RegExp(`(${query})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/30 px-0.5 rounded">{part}</mark>
      : part
  )
}

export function FullTextSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const setSection = useAppStore((s) => s.setSection)

  const search = async (q: string) => {
    if (!q.trim() || q.length < 1) {
      setResults([])
      setHasSearched(false)
      return
    }
    setLoading(true)
    setHasSearched(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data.results || [])
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const handleInput = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  const filteredResults = filter === 'all' ? results : results.filter((r) => r.type === filter)

  const typeCounts = results.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-3">
      <Card className="bg-cyan-500/5 border-cyan-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          🔍 <strong className="text-cyan-700 dark:text-cyan-400">全文搜索</strong>
          跨论文（标题/作者/标签/笔记）、课题、笔记内容、实验名称搜索 · 实时结果高亮
        </CardContent>
      </Card>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="输入关键词搜索... (支持论文标题、作者、笔记内容等)"
          className="pl-9 h-10"
          autoFocus
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-primary" />
        )}
      </div>

      {/* Filter buttons */}
      {hasSearched && results.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">类型:</span>
          <button
            onClick={() => setFilter('all')}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
              filter === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
            )}
          >
            全部 ({results.length})
          </button>
          {Object.entries(TYPE_CONFIG).map(([type, config]) => {
            const count = typeCounts[type] || 0
            if (count === 0) return null
            return (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
                  filter === type ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                )}
              >
                <config.icon className="h-2.5 w-2.5" />
                {config.label} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Results */}
      {hasSearched && (
        <div className="space-y-2">
          {filteredResults.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <Search className="h-10 w-10 mx-auto mb-2 opacity-30" />
                {query ? `未找到包含 "${query}" 的结果` : '开始输入以搜索...'}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="text-[10px] text-muted-foreground px-1">
                找到 {filteredResults.length} 个结果 · 关键词: "{query}"
              </div>
              {filteredResults.map((r) => {
                const config = TYPE_CONFIG[r.type]
                const Icon = config.icon
                return (
                  <Card
                    key={`${r.type}-${r.id}`}
                    className="card-hover cursor-pointer group"
                    onClick={() => {
                      const section = NAV_MAP[r.type]
                      if (section) {
                        setSection(section)
                        toast.success(`已跳转到${config.label}`)
                      }
                    }}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', config.color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium line-clamp-1">
                              {highlightText(r.title, query)}
                            </span>
                            <Badge variant="secondary" className={cn('text-[9px] py-0 shrink-0', config.color)}>
                              {config.label}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground line-clamp-1">
                            {highlightText(r.subtitle, query)}
                          </div>
                          {r.tags && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {r.tags.split(',').slice(0, 3).map((t) => (
                                <Badge key={t} variant="outline" className="text-[9px] py-0">
                                  #{highlightText(t.trim(), query)}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </>
          )}
        </div>
      )}

      {!hasSearched && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Search className="h-10 w-10 mx-auto mb-2 opacity-30" />
            输入关键词开始搜索 · 支持论文、课题、笔记、实验
          </CardContent>
        </Card>
      )}
    </div>
  )
}
