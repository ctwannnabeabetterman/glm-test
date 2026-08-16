'use client'

import { useFetch } from '@/lib/hooks'
import { useState } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Flame, TrendingUp, BookOpen, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ReadingDay {
  date: string
  count: number
  papers: Array<{ title: string; status: string }>
}
interface ReadingActivity {
  days: ReadingDay[]
  stats: {
    totalRead: number
    totalReading: number
    activeDays: number
    currentStreak: number
    longestStreak: number
    totalPapers: number
  }
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

export function ReadingHeatmap() {
  const { data: activity, loading } = useFetch<ReadingActivity>('/api/reading-activity')
  const [hoveredDay, setHoveredDay] = useState<ReadingDay | null>(null)

  if (loading || !activity) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          加载阅读活动数据...
        </CardContent>
      </Card>
    )
  }

  // Group days into weeks (columns)
  const weeks: ReadingDay[][] = []
  for (let i = 0; i < activity.days.length; i += 7) {
    weeks.push(activity.days.slice(i, i + 7))
  }

  // Get color for a day based on count
  const getColor = (count: number) => {
    if (count === 0) return 'bg-muted/40'
    if (count === 1) return 'bg-emerald-500/30'
    if (count === 2) return 'bg-emerald-500/50'
    if (count === 3) return 'bg-emerald-500/70'
    return 'bg-emerald-500'
  }

  // Get month labels for columns
  const monthLabels: Array<{ weekIdx: number; label: string }> = []
  let lastMonth = -1
  weeks.forEach((week, idx) => {
    if (week[0]) {
      const month = new Date(week[0].date).getMonth()
      if (month !== lastMonth) {
        monthLabels.push({ weekIdx: idx, label: MONTH_LABELS[month] })
        lastMonth = month
      }
    }
  })

  const stats = activity.stats

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              阅读活动热力图
            </CardTitle>
            <CardDescription className="text-xs">
              方法论 §2.2.4 阅读进度跟踪 · 最近 12 周阅读记录
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>少</span>
              <div className="h-2.5 w-2.5 rounded-sm bg-muted/40" />
              <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500/30" />
              <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500/50" />
              <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500/70" />
              <div className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              <span>多</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatBox
            icon={BookOpen}
            label="已读论文"
            value={stats.totalRead}
            color="text-emerald-600"
          />
          <StatBox
            icon={TrendingUp}
            label="阅读中"
            value={stats.totalReading}
            color="text-blue-600"
          />
          <StatBox
            icon={Calendar}
            label="活跃天数"
            value={stats.activeDays}
            color="text-purple-600"
          />
          <StatBox
            icon={Flame}
            label="当前连续"
            value={`${stats.currentStreak}天`}
            color="text-orange-500"
          />
          <StatBox
            icon={Flame}
            label="最长连续"
            value={`${stats.longestStreak}天`}
            color="text-red-500"
          />
        </div>

        {/* Heatmap grid */}
        <div className="overflow-x-auto">
          <div className="inline-flex flex-col gap-1 min-w-full">
            {/* Month labels row */}
            <div className="flex gap-1 pl-6 h-4">
              {weeks.map((_, weekIdx) => {
                const monthLabel = monthLabels.find((m) => m.weekIdx === weekIdx)
                return (
                  <div key={weekIdx} className="w-3 text-[9px] text-muted-foreground">
                    {monthLabel?.label || ''}
                  </div>
                )
              })}
            </div>

            {/* Grid with weekday labels */}
            <div className="flex gap-1">
              {/* Weekday labels */}
              <div className="flex flex-col gap-1 pr-1">
                {WEEKDAY_LABELS.map((day, i) => (
                  <div key={i} className="h-3 w-5 text-[9px] text-muted-foreground flex items-center">
                    {i % 2 === 1 ? day : ''}
                  </div>
                ))}
              </div>

              {/* Weeks */}
              {weeks.map((week, weekIdx) => (
                <div key={weekIdx} className="flex flex-col gap-1">
                  {week.map((day, dayIdx) => (
                    <div
                      key={dayIdx}
                      className={cn(
                        'h-3 w-3 rounded-sm transition-all cursor-pointer hover:ring-1 hover:ring-primary/50 hover:ring-offset-1',
                        getColor(day.count)
                      )}
                      onMouseEnter={() => setHoveredDay(day)}
                      onMouseLeave={() => setHoveredDay(null)}
                      title={`${day.date}: ${day.count} 篇`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Hover tooltip */}
        {hoveredDay && (
          <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{hoveredDay.date}</span>
              <Badge variant="secondary" className="text-[10px]">
                {hoveredDay.count} 篇
              </Badge>
            </div>
            {hoveredDay.papers.length > 0 ? (
              <div className="space-y-0.5">
                {hoveredDay.papers.map((p, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground truncate">
                    • {p.title}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">当天无阅读记录</div>
            )}
          </div>
        )}

        {/* Motivational message */}
        <div className="rounded-md bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 p-2.5 text-xs text-center">
          {stats.currentStreak > 0 ? (
            <span className="text-orange-700 dark:text-orange-400">
              🔥 你已连续阅读 <strong>{stats.currentStreak}</strong> 天！保持这个节奏，每周读 3-5 篇论文即可
            </span>
          ) : (
            <span className="text-muted-foreground">
              💡 建议每周一早上运行 arXiv 监控脚本，花 30 分钟扫读标题+摘要，保持阅读习惯
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function StatBox({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  color: string
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-2 text-center">
      <div className="flex items-center justify-center gap-1 mb-0.5">
        <Icon className={cn('h-3 w-3', color)} />
        <span className={cn('text-base font-bold', color)}>{value}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
