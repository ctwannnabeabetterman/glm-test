'use client'

import { useFetch } from '@/lib/hooks'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BarChart3, Clock, TrendingUp, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'

interface DailyData {
  date: string
  totalSeconds: number
  sessionCount: number
  paperCount: number
}
interface SessionData {
  dailyData: DailyData[]
  stats: {
    totalSeconds: number
    totalSessions: number
    activeDays: number
    avgPerDay: number
    period: number
  }
  topPapers: Array<{ paperId: string; title: string; totalSeconds: number; sessions: number }>
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// Custom tooltip (extracted as static component)
function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DailyData }> }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
      <div className="font-medium">{d.date}</div>
      <div className="text-muted-foreground mt-1">
        <div>⏱️ {formatDuration(d.totalSeconds)}</div>
        <div>📊 {d.sessionCount} 次会话</div>
        <div>📖 {d.paperCount} 篇论文</div>
      </div>
    </div>
  )
}

export function ReadingSessionHistory() {
  const { data, loading } = useFetch<SessionData>('/api/reading-sessions?days=30')

  if (loading || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          加载阅读历史...
        </CardContent>
      </Card>
    )
  }

  const { dailyData, stats, topPapers } = data
  const maxSeconds = Math.max(...dailyData.map((d) => d.totalSeconds), 1)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              阅读时长历史
            </CardTitle>
            <CardDescription className="text-xs">
              最近 30 天每日阅读时长 · 追踪阅读习惯
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2">
          <StatBox icon={Clock} label="总时长" value={formatDuration(stats.totalSeconds)} color="text-primary" />
          <StatBox icon={Calendar} label="会话数" value={stats.totalSessions} color="text-blue-600" />
          <StatBox icon={TrendingUp} label="活跃天数" value={`${stats.activeDays}/${stats.period}`} color="text-emerald-600" />
          <StatBox icon={Clock} label="日均" value={formatDuration(stats.avgPerDay)} color="text-amber-600" />
        </div>

        {/* Bar chart */}
        {stats.totalSeconds > 0 ? (
          <div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailyData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  fontSize={9}
                  interval={4}
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis
                  tickFormatter={(v) => formatDuration(v as number)}
                  fontSize={9}
                  width={40}
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="totalSeconds" radius={[3, 3, 0, 0]}>
                  {dailyData.map((d, i) => {
                    const intensity = d.totalSeconds / maxSeconds
                    const color = intensity > 0.66 ? '#10b981' : intensity > 0.33 ? '#3b82f6' : intensity > 0 ? '#f59e0b' : '#e5e7eb'
                    return <Cell key={i} fill={color} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
            <div className="text-center">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-30" />
              开始阅读论文，这里将显示你的阅读时长趋势
            </div>
          </div>
        )}

        {/* Top papers by reading time */}
        {topPapers.length > 0 && (
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              阅读时长 Top 5
            </div>
            <div className="space-y-1.5">
              {topPapers.map((p, i) => (
                <div key={p.paperId} className="flex items-center gap-2 rounded-md border border-border/40 p-2">
                  <div className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                    i === 0 ? 'bg-amber-500 text-white' : i === 1 ? 'bg-slate-400 text-white' : i === 2 ? 'bg-orange-700 text-white' : 'bg-muted text-muted-foreground'
                  )}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{p.title || '未知论文'}</div>
                    <div className="text-[9px] text-muted-foreground">{p.sessions} 次会话</div>
                  </div>
                  <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary shrink-0">
                    {formatDuration(p.totalSeconds)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
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
        <span className={cn('text-sm font-bold', color)}>{value}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
