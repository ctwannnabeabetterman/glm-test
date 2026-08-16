'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState } from 'react'
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
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Target, TrendingUp, Calendar, Edit3, Award, Flame, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Goal {
  id: string
  type: string
  target: number
  period: string
  progress: number
  pct: number
}
interface ReadingGoalsData {
  current: { weekly: Goal; monthly: Goal }
  history: Array<{ id: string; type: string; target: number; period: string }>
}

export function ReadingGoals() {
  const { data, loading, refetch } = useFetch<ReadingGoalsData>('/api/reading-goals')
  const api = useApi()
  const [editOpen, setEditOpen] = useState<'weekly' | 'monthly' | null>(null)
  const [editValue, setEditValue] = useState(3)

  if (loading || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          加载阅读目标...
        </CardContent>
      </Card>
    )
  }

  const { weekly, monthly } = data.current

  const saveGoal = async (type: 'weekly' | 'monthly') => {
    try {
      await api.post('/api/reading-goals', { type, target: editValue })
      toast.success(`${type === 'weekly' ? '每周' : '每月'}目标已更新为 ${editValue} 篇`)
      setEditOpen(null)
      refetch()
    } catch {
      toast.error('更新失败')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              阅读目标追踪
            </CardTitle>
            <CardDescription className="text-xs">
              设定每周/每月阅读目标 · 保持科研节奏
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Weekly goal */}
          <GoalCard
            goal={weekly}
            title="本周目标"
            icon={Calendar}
            color="emerald"
            periodLabel={`第 ${weekly.period.split('-W')[1]} 周`}
            onEdit={() => { setEditValue(weekly.target); setEditOpen('weekly') }}
          />
          {/* Monthly goal */}
          <GoalCard
            goal={monthly}
            title="本月目标"
            icon={Award}
            color="amber"
            periodLabel={`${monthly.period.split('-')[1]} 月`}
            onEdit={() => { setEditValue(monthly.target); setEditOpen('monthly') }}
          />
        </div>

        {/* Motivational message */}
        <div className={cn(
          'rounded-md border p-2.5 text-xs text-center',
          weekly.pct >= 100
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
            : weekly.pct >= 50
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
        )}>
          {weekly.pct >= 100 ? (
            <span className="flex items-center justify-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              🎉 本周目标已达成！已读 {weekly.progress} 篇，超额 {weekly.progress - weekly.target} 篇
            </span>
          ) : weekly.pct >= 50 ? (
            <span className="flex items-center justify-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              📈 本周进度过半！还差 {weekly.target - weekly.progress} 篇即可达成目标
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">
              <Flame className="h-3.5 w-3.5" />
              💪 本周已读 {weekly.progress} 篇，目标 {weekly.target} 篇，加油！
            </span>
          )}
        </div>

        {/* Edit dialog */}
        <Dialog open={editOpen !== null} onOpenChange={(o) => !o && setEditOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                设置{editOpen === 'weekly' ? '每周' : '每月'}阅读目标
              </DialogTitle>
              <DialogDescription>
                建议每周读 3-5 篇论文，每月 12-20 篇。保持稳定节奏比突击阅读更有效。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>目标论文数</Label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={editValue}
                  onChange={(e) => setEditValue(Number(e.target.value))}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[3, 5, 10, 15].map((v) => (
                  <button
                    key={v}
                    onClick={() => setEditValue(v)}
                    className={cn(
                      'rounded-md border py-1.5 text-xs font-medium transition-all',
                      editValue === v
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/40'
                    )}
                  >
                    {v} 篇
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(null)}>取消</Button>
              <Button onClick={() => editOpen && saveGoal(editOpen)}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

function GoalCard({ goal, title, icon: Icon, color, periodLabel, onEdit }: {
  goal: Goal
  title: string
  icon: React.ComponentType<{ className?: string }>
  color: 'emerald' | 'amber'
  periodLabel: string
  onEdit: () => void
}) {
  const colorMap = {
    emerald: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-600',
      bar: '[&>div]:bg-emerald-500',
      ring: 'ring-emerald-500/20',
    },
    amber: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-600',
      bar: '[&>div]:bg-amber-500',
      ring: 'ring-amber-500/20',
    },
  }
  const c = colorMap[color]
  const isComplete = goal.pct >= 100

  return (
    <div className={cn('rounded-lg border p-3 transition-all', isComplete && `ring-1 ${c.ring}`)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-md', c.bg, c.text)}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-medium">{title}</div>
            <div className="text-[10px] text-muted-foreground">{periodLabel}</div>
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit}>
          <Edit3 className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className={cn('text-2xl font-bold', c.text)}>{goal.progress}</span>
        <span className="text-xs text-muted-foreground">/ {goal.target} 篇</span>
        {isComplete && (
          <Badge variant="secondary" className="text-[9px] ml-auto bg-emerald-500/15 text-emerald-600">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
            已达成
          </Badge>
        )}
      </div>

      <Progress value={goal.pct} className={cn('h-2', c.bar)} />

      <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
        <span>{goal.pct.toFixed(0)}% 完成</span>
        <span>{Math.max(0, goal.target - goal.progress)} 篇剩余</span>
      </div>
    </div>
  )
}
