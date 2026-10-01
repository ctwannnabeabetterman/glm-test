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
    // Compact vertical view —— 单一中性色，数字等宽对齐
    return (
      <div className="border-t border-border p-2 space-y-1.5" aria-label="快速统计">
        <CompactStat icon={BookOpen} value={stats?.papers.total ?? 0} title="论文" />
        <CompactStat icon={Target} value={stats?.topics.total ?? 0} title="课题" />
        <CompactStat icon={FlaskConical} value={stats?.experiments.total ?? 0} title="实验" />
        <CompactStat icon={StickyNote} value={stats?.notes.total ?? 0} title="笔记" />
      </div>
    )
  }

  /* 设计令牌要求「黑白灰 + 一个强调色」：去掉原先的四色图标底，
     层级靠数字字号/字重表达（原 8–9px 文字低于可读下限，统一抬到 11–12px） */
  const items = [
    { label: '论文', value: stats?.papers.total ?? 0, sub: `${stats?.papers.read ?? 0} 已读`, icon: BookOpen },
    { label: '课题', value: stats?.topics.total ?? 0, sub: `${stats?.topics.top[0]?.totalScore.toFixed(1) ?? '-'} 分`, icon: Target },
    { label: '实验', value: stats?.experiments.total ?? 0, sub: `${stats?.experiments.completed ?? 0} 完成`, icon: FlaskConical },
    { label: '笔记', value: stats?.notes.total ?? 0, sub: '篇', icon: StickyNote },
  ]

  return (
    <section className="border-t border-border px-2.5 py-3" aria-label="快速统计">
      <div className="eyebrow mb-2 px-1">快速统计</div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.label} className="bg-card px-2 py-1.5">
              <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Icon className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                {item.label}
              </dt>
              <dd className="mt-0.5 flex items-baseline gap-1 min-w-0">
                <span className="tabular text-[15px] font-semibold leading-tight">{item.value}</span>
                <span className="text-[11px] text-muted-foreground truncate">{item.sub}</span>
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function CompactStat({ icon: Icon, value, title }: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  value: number
  title: string
}) {
  return (
    <div className="flex items-center justify-center gap-1 text-muted-foreground" title={title} aria-label={`${title} ${value}`}>
      <Icon className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
      <span className={cn('tabular text-xs font-semibold text-foreground')}>{value}</span>
    </div>
  )
}
