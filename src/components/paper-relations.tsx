'use client'

import { useFetch } from '@/lib/hooks'
import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Network, Tag, FolderTree, User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Paper {
  id: string
  title: string
  authors: string
  venue: string
  year: number
  category: string
  tags: string
  status: string
  priority: string
  relevance: number
}

type RelationType = 'shared-tag' | 'same-category' | 'shared-author'

interface Relation {
  paperA: Paper
  paperB: Paper
  type: RelationType
  strength: number
  detail: string
}

const TYPE_CONFIG: Record<RelationType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  'shared-tag': { label: '共享标签', icon: Tag, color: 'text-purple-600 bg-purple-500/10' },
  'same-category': { label: '同分类', icon: FolderTree, color: 'text-emerald-600 bg-emerald-500/10' },
  'shared-author': { label: '同作者', icon: User, color: 'text-blue-600 bg-blue-500/10' },
}

export function PaperRelations() {
  const { data: papers, loading } = useFetch<Paper[]>('/api/papers')
  const [selectedPaper, setSelectedPaper] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<RelationType | 'all'>('all')

  // Calculate relations
  const relations = useMemo(() => {
    if (!papers) return []
    const result: Relation[] = []

    for (let i = 0; i < papers.length; i++) {
      for (let j = i + 1; j < papers.length; j++) {
        const a = papers[i]
        const b = papers[j]

        // Shared tags
        const tagsA = (a.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        const tagsB = (b.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        const sharedTags = tagsA.filter((t) => tagsB.includes(t))
        if (sharedTags.length > 0) {
          result.push({ paperA: a, paperB: b, type: 'shared-tag', strength: sharedTags.length, detail: sharedTags.join(', ') })
        }

        // Same category
        if (a.category && a.category === b.category) {
          result.push({ paperA: a, paperB: b, type: 'same-category', strength: 1, detail: a.category })
        }

        // Shared author
        const authorsA = (a.authors || '').split(',').map((au) => au.trim().toLowerCase()).filter((au) => au.length > 2)
        const authorsB = (b.authors || '').split(',').map((au) => au.trim().toLowerCase()).filter((au) => au.length > 2)
        const sharedAuthors = authorsA.filter((au) => authorsB.includes(au))
        if (sharedAuthors.length > 0) {
          result.push({ paperA: a, paperB: b, type: 'shared-author', strength: sharedAuthors.length, detail: sharedAuthors.join(', ') })
        }
      }
    }

    return result.sort((x, y) => y.strength - x.strength)
  }, [papers])

  // Filter relations
  const filteredRelations = useMemo(() => {
    let result = relations
    if (filterType !== 'all') {
      result = result.filter((r) => r.type === filterType)
    }
    if (selectedPaper) {
      result = result.filter((r) => r.paperA.id === selectedPaper || r.paperB.id === selectedPaper)
    }
    return result
  }, [relations, filterType, selectedPaper])

  // Get relation count per paper
  const paperRelationCount = useMemo(() => {
    const counts: Record<string, number> = {}
    relations.forEach((r) => {
      counts[r.paperA.id] = (counts[r.paperA.id] || 0) + 1
      counts[r.paperB.id] = (counts[r.paperB.id] || 0) + 1
    })
    return counts
  }, [relations])

  if (loading) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">加载关系数据...</CardContent></Card>
  }

  if (!papers || papers.length < 2) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Network className="h-10 w-10 mx-auto mb-2 opacity-30" />
          需要至少 2 篇论文才能分析关系
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-border/60 bg-card p-2 text-center">
          <div className="text-lg font-bold text-primary">{relations.length}</div>
          <div className="text-[10px] text-muted-foreground">总关系数</div>
        </div>
        <div className="rounded-md border border-border/60 bg-card p-2 text-center">
          <div className="text-lg font-bold text-emerald-600">
            {relations.filter((r) => r.type === 'same-category').length}
          </div>
          <div className="text-[10px] text-muted-foreground">同分类</div>
        </div>
        <div className="rounded-md border border-border/60 bg-card p-2 text-center">
          <div className="text-lg font-bold text-purple-600">
            {relations.filter((r) => r.type === 'shared-tag').length}
          </div>
          <div className="text-[10px] text-muted-foreground">共享标签</div>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground">筛选:</span>
        <button
          onClick={() => setFilterType('all')}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
            filterType === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
          )}
        >
          全部 ({relations.length})
        </button>
        {(Object.keys(TYPE_CONFIG) as RelationType[]).map((t) => {
          const config = TYPE_CONFIG[t]
          const count = relations.filter((r) => r.type === t).length
          return (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
                filterType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
              )}
            >
              <config.icon className="h-2.5 w-2.5" />
              {config.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Paper selector */}
      {selectedPaper && (
        <div className="flex items-center gap-2 rounded-md bg-primary/5 border border-primary/20 p-2">
          <span className="text-[10px] text-muted-foreground">已选论文:</span>
          <span className="text-[11px] font-medium text-primary truncate flex-1">
            {papers.find((p) => p.id === selectedPaper)?.title}
          </span>
          <button
            onClick={() => setSelectedPaper(null)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            ✕ 清除
          </button>
        </div>
      )}

      {/* Paper grid for selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
        {papers.map((p) => {
          const count = paperRelationCount[p.id] || 0
          const isSelected = selectedPaper === p.id
          return (
            <button
              key={p.id}
              onClick={() => setSelectedPort(isSelected ? null : p.id)}
              className={cn(
                'flex items-center gap-2 rounded-md border p-1.5 text-left transition-all',
                isSelected ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-primary/40',
                count === 0 && 'opacity-50'
              )}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {count}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-medium truncate">{p.title}</div>
                <div className="text-[9px] text-muted-foreground truncate">{p.year} · {p.venue}</div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Relations list */}
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {filteredRelations.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center text-xs text-muted-foreground">
              {selectedPaper ? '该论文暂无匹配的关系' : '暂无匹配的关系'}
            </CardContent>
          </Card>
        ) : (
          filteredRelations.map((r, i) => {
            const config = TYPE_CONFIG[r.type]
            return (
              <div
                key={i}
                className="rounded-md border border-border/60 p-2 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', config.color)}>
                    <config.icon className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSelectedPort(r.paperA.id)}
                      className="text-[10px] text-left truncate hover:text-primary hover:underline"
                      title={r.paperA.title}
                    >
                      {r.paperA.title}
                    </button>
                    <button
                      onClick={() => setSelectedPort(r.paperB.id)}
                      className="text-[10px] text-left truncate hover:text-primary hover:underline"
                      title={r.paperB.title}
                    >
                      {r.paperB.title}
                    </button>
                  </div>
                  <Badge variant="secondary" className={cn('text-[9px] shrink-0', config.color)}>
                    {r.detail}
                  </Badge>
                  {r.strength > 1 && (
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      ×{r.strength}
                    </Badge>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  function setSelectedPort(id: string | null) {
    setSelectedPaper(id)
  }
}
