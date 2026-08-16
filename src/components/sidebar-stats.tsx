'use client'

import { useFetch } from '@/lib/hooks'
import { BookOpen, Target, FlaskConical, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Stats {
  papers: { total: number; read: number; reading: number; unread: number; highPriority: number }
  topics: { total: number; top: { id: string; name: string; totalScore: number; direction: string }[] }
  experiments: { total: number; planned: number; completed: number }
  milestones: { total: number; gantt: number; writing: number; submission: number }
  notes: { total: number }
}

export function SidebarStats({ collapsed }: { collapsed: boolean }) {
  const { data: stats } = useFetch<Stats>('/api/stats')

  if (collapsed) {
    // Compact vertical view
    return (
      <div className="border-t border-border p-2 space-y-1.5">
        <CompactStat icon={BookOpen} value={stats?.papers.total ?? 0} color="text-emerald-600" title="论文" />
        <CompactStat icon={Target} value={stats?.topics.total ?? 0} color="text-amber-600" title="课题" />
        <CompactStat icon={FlaskConical} value={stats?.experiments.total ?? 0} color="text-purple-600" title="实验" />
        <CompactStat icon={StickyNote} value={stats?.notes.total ?? 0} color="text-blue-600" title="笔记" />
      </div>
    )
  }

  const items = [
    { label: '论文', value: stats?.papers.total ?? 0, sub: `${stats?.papers.read ?? 0} 已读`, icon: BookOpen, color: 'text-emerald-600 bg-emerald-500/10' },
    { label: '课题', value: stats?.topics.total ?? 0, sub: `${stats?.topics.top[0]?.totalScore.toFixed(1) ?? '-'} 分`, icon: Target, color: 'text-amber-600 bg-amber-500/10' },
    { label: '实验', value: stats?.experiments.total ?? 0, sub: `${stats?.experiments.completed ?? 0} 完成`, icon: FlaskConical, color: 'text-purple-600 bg-purple-500/10' },
    { label: '笔记', value: stats?.notes.total ?? 0, sub: '篇', icon: StickyNote, color: 'text-blue-600 bg-blue-500/10' },
  ]

  return (
    <div className="border-t border-border p-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
        快速统计
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <div
              key={item.label}
              className="rounded-md border border-border/40 bg-card/50 p-1.5 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-1 mb-0.5">
                <div className={cn('flex h-4 w-4 items-center justify-center rounded', item.color)}>
                  <Icon className="h-2.5 w-2.5" />
                </div>
                <span className="text-[9px] text-muted-foreground">{item.label}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-bold">{item.value}</span>
                <span className="text-[8px] text-muted-foreground truncate">{item.sub}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompactStat({ icon: Icon, value, color, title }: {
  icon: React.ComponentType<{ className?: string }>
  value: number
  color: string
  title: string
}) {
  return (
    <div className="flex items-center justify-center gap-1" title={title}>
      <Icon className={cn('h-3 w-3', color)} />
      <span className="text-xs font-bold">{value}</span>
    </div>
  )
}
