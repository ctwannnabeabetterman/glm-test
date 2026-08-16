'use client'

import { useFetch } from '@/lib/hooks'
import { useState, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { GitBranch, Calendar, CheckCircle2, Circle, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Milestone {
  id: string
  type: string
  title: string
  description: string
  startDate: string
  endDate: string
  duration: number
  progress: number
  category: string
  color: string
  targetVenue: string
  createdAt: string
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  gantt: { label: '研究任务', color: 'bg-blue-500/15 text-blue-600' },
  writing: { label: '写作里程碑', color: 'bg-purple-500/15 text-purple-600' },
  submission: { label: '投稿计划', color: 'bg-pink-500/15 text-pink-600' },
}

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  survey: Calendar,
  baseline: CheckCircle2,
  method: GitBranch,
  simulation: Clock,
  experiment: AlertCircle,
  analysis: CheckCircle2,
  writing: Calendar,
  submission: Clock,
  defense: Circle,
}

export function ProgressTimeline() {
  const { data: milestones, loading } = useFetch<Milestone[]>('/api/milestones')
  const [filterType, setFilterType] = useState<string>('all')

  // Sort by creation date (oldest first for timeline)
  const sortedMilestones = useMemo(() => {
    if (!milestones) return []
    return [...milestones].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [milestones])

  const filtered = useMemo(() => {
    if (filterType === 'all') return sortedMilestones
    return sortedMilestones.filter((m) => m.type === filterType)
  }, [sortedMilestones, filterType])

  // Calculate stats
  const stats = useMemo(() => {
    if (!sortedMilestones.length) return { total: 0, completed: 0, inProgress: 0, notStarted: 0, avgProgress: 0 }
    const completed = sortedMilestones.filter((m) => m.progress >= 100).length
    const inProgress = sortedMilestones.filter((m) => m.progress > 0 && m.progress < 100).length
    const notStarted = sortedMilestones.filter((m) => m.progress === 0).length
    const avgProgress = sortedMilestones.reduce((sum, m) => sum + m.progress, 0) / sortedMilestones.length
    return { total: sortedMilestones.length, completed, inProgress, notStarted, avgProgress }
  }, [sortedMilestones])

  if (loading) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">加载进度数据...</CardContent></Card>
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              研究进度时间线
            </CardTitle>
            <CardDescription className="text-xs">
              可视化所有里程碑 · 追踪研究进展
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {stats.completed}/{stats.total} 完成
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overall progress */}
        <div className="rounded-md bg-muted/30 p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">总体进度</span>
            <span className="text-xs font-bold text-primary">{stats.avgProgress.toFixed(0)}%</span>
          </div>
          <Progress value={stats.avgProgress} className="h-2" />
          <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
            <div className="text-center">
              <div className="font-bold text-emerald-600">{stats.completed}</div>
              <div className="text-muted-foreground">已完成</div>
            </div>
            <div className="text-center">
              <div className="font-bold text-amber-600">{stats.inProgress}</div>
              <div className="text-muted-foreground">进行中</div>
            </div>
            <div className="text-center">
              <div className="font-bold text-muted-foreground">{stats.notStarted}</div>
              <div className="text-muted-foreground">未开始</div>
            </div>
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">筛选:</span>
          <button
            onClick={() => setFilterType('all')}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
              filterType === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
            )}
          >
            全部 ({sortedMilestones.length})
          </button>
          {Object.entries(TYPE_LABELS).map(([type, config]) => {
            const count = sortedMilestones.filter((m) => m.type === type).length
            if (count === 0) return null
            return (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
                  filterType === type ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'
                )}
              >
                {config.label} ({count})
              </button>
            )
          })}
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">
                <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-30" />
                暂无里程碑数据
              </div>
            ) : (
              filtered.map((m, idx) => {
                const isComplete = m.progress >= 100
                const isInProgress = m.progress > 0 && m.progress < 100
                const typeConfig = TYPE_LABELS[m.type] || TYPE_LABELS.gantt
                const CategoryIcon = CATEGORY_ICONS[m.category] || Circle
                return (
                  <div key={m.id} className="relative pl-10">
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        'absolute left-1.5 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background z-10',
                        isComplete ? 'bg-emerald-500' : isInProgress ? 'bg-amber-500' : 'bg-muted'
                      )}
                      style={!isComplete && !isInProgress ? { borderColor: m.color } : {}}
                    >
                      {isComplete && <CheckCircle2 className="h-3 w-3 text-white" />}
                      {isInProgress && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                    </div>

                    {/* Card */}
                    <div
                      className={cn(
                        'rounded-md border p-2.5 transition-all hover:shadow-sm',
                        isComplete ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-card'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                            <span className="text-xs font-medium">{m.title}</span>
                            <Badge variant="secondary" className={cn('text-[9px] py-0', typeConfig.color)}>
                              {typeConfig.label}
                            </Badge>
                          </div>
                          {m.description && (
                            <div className="text-[10px] text-muted-foreground line-clamp-1">{m.description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <div
                            className="flex h-6 w-6 items-center justify-center rounded-md"
                            style={{ background: `${m.color}20`, color: m.color }}
                          >
                            <CategoryIcon className="h-3 w-3" />
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="flex items-center gap-2">
                        <Progress value={m.progress} className="h-1.5 flex-1" />
                        <span className="text-[9px] text-muted-foreground shrink-0 w-8 text-right">
                          {m.progress}%
                        </span>
                      </div>

                      {/* Meta info */}
                      <div className="flex items-center gap-2 mt-1.5 text-[9px] text-muted-foreground">
                        {m.startDate && m.endDate && (
                          <span className="flex items-center gap-0.5">
                            <Calendar className="h-2.5 w-2.5" />
                            {m.type === 'gantt' ? `第${m.startDate}-${m.endDate}周` : `${m.startDate}`}
                          </span>
                        )}
                        {m.targetVenue && (
                          <Badge variant="outline" className="text-[9px] py-0">
                            {m.targetVenue}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
