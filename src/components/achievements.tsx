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
import { Progress } from '@/components/ui/progress'
import { Award, Lock, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Achievement {
  id: string
  icon: string
  title: string
  desc: string
  category: string
  unlocked: boolean
  progress: number
  target: number
  color: string
}
interface AchievementsData {
  achievements: Achievement[]
  stats: {
    unlocked: number
    total: number
    currentStreak: number
    totalRead: number
    totalTime: number
    totalNotes: number
    totalExperiments: number
    totalTopics: number
  }
  categories: string[]
}

const CATEGORY_LABELS: Record<string, string> = {
  reading: '阅读成就',
  streak: '连续打卡',
  time: '阅读时长',
  notes: '笔记成就',
  research: '研究成就',
  collection: '收藏成就',
}

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; gradient: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/30', gradient: 'from-emerald-500/20 to-emerald-500/5' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-500/30', gradient: 'from-blue-500/20 to-blue-500/5' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-600', border: 'border-purple-500/30', gradient: 'from-purple-500/20 to-purple-500/5' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-600', border: 'border-amber-500/30', gradient: 'from-amber-500/20 to-amber-500/5' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-600', border: 'border-orange-500/30', gradient: 'from-orange-500/20 to-orange-500/5' },
  red: { bg: 'bg-red-500/10', text: 'text-red-600', border: 'border-red-500/30', gradient: 'from-red-500/20 to-red-500/5' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-600', border: 'border-pink-500/30', gradient: 'from-pink-500/20 to-pink-500/5' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-600', border: 'border-cyan-500/30', gradient: 'from-cyan-500/20 to-cyan-500/5' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-600', border: 'border-indigo-500/30', gradient: 'from-indigo-500/20 to-indigo-500/5' },
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function Achievements() {
  const { data, loading } = useFetch<AchievementsData>('/api/achievements')

  if (loading || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          加载成就...
        </CardContent>
      </Card>
    )
  }

  const { achievements, stats } = data
  const pct = (stats.unlocked / stats.total) * 100

  // Group by category
  const grouped: Record<string, Achievement[]> = {}
  achievements.forEach((a) => {
    if (!grouped[a.category]) grouped[a.category] = []
    grouped[a.category].push(a)
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-500" />
              成就与徽章
            </CardTitle>
            <CardDescription className="text-xs">
              科研里程碑追踪 · 激励持续学习
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-amber-500/15 text-amber-600 font-bold">
              <Sparkles className="h-2.5 w-2.5 mr-0.5" />
              {stats.unlocked} / {stats.total}
            </Badge>
          </div>
        </div>
        {/* Overall progress bar */}
        <div className="mt-2">
          <Progress value={pct} className="h-1.5" />
          <div className="text-[10px] text-muted-foreground mt-1 text-right">
            {pct.toFixed(0)}% 已解锁
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick stats */}
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          <QuickStat label="已读论文" value={stats.totalRead} icon="📖" />
          <QuickStat label="当前连续" value={`${stats.currentStreak}天`} icon="🔥" />
          <QuickStat label="阅读时长" value={formatTime(stats.totalTime)} icon="⏰" />
          <QuickStat label="笔记数" value={stats.totalNotes} icon="📝" />
          <QuickStat label="实验数" value={stats.totalExperiments} icon="🔬" />
        </div>

        {/* Achievements by category */}
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-primary" />
              {CATEGORY_LABELS[category] || category}
              <span className="text-[9px] text-muted-foreground/70">
                ({items.filter((i) => i.unlocked).length}/{items.length})
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {items.map((a) => {
                const c = COLOR_MAP[a.color] || COLOR_MAP.emerald
                const progressPct = (a.progress / a.target) * 100
                return (
                  <div
                    key={a.id}
                    className={cn(
                      'relative rounded-lg border p-2.5 transition-all overflow-hidden',
                      a.unlocked
                        ? cn(c.border, 'bg-gradient-to-br', c.gradient)
                        : 'border-border/60 bg-muted/20 opacity-70'
                    )}
                  >
                    {a.unlocked && (
                      <div className="absolute top-1.5 right-1.5">
                        <div className={cn('flex h-4 w-4 items-center justify-center rounded-full', c.bg, c.text)}>
                          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-md text-base',
                        a.unlocked ? c.bg : 'bg-muted/40 grayscale'
                      )}>
                        {a.unlocked ? a.icon : <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          'text-[11px] font-medium truncate',
                          a.unlocked ? c.text : 'text-muted-foreground'
                        )}>
                          {a.title}
                        </div>
                        <div className="text-[9px] text-muted-foreground truncate">{a.desc}</div>
                      </div>
                    </div>
                    {!a.unlocked && a.progress > 0 && (
                      <div>
                        <Progress value={progressPct} className="h-1" />
                        <div className="text-[9px] text-muted-foreground mt-0.5 text-right">
                          {a.progress} / {a.target}
                        </div>
                      </div>
                    )}
                    {a.unlocked && (
                      <div className="text-[9px] text-muted-foreground">
                        ✓ 已达成
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function QuickStat({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-2 text-center">
      <div className="text-base mb-0.5">{icon}</div>
      <div className="text-sm font-bold">{value}</div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  )
}
