'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState, useMemo } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { SectionHeader } from './papers-section'
import { GANTT_TEMPLATE, WRITING_MILESTONES, WEEKLY_PLAN_TEMPLATE, VENUES } from '@/lib/methodology-data'
import {
  Calendar,
  Plus,
  Trash2,
  Clock,
  TrendingUp,
  Award,
  Target,
  Flag,
  GitCommitHorizontal,
  GitBranch,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ProgressTimeline } from '@/components/progress-timeline'

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
}

export function PlannerSection() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="研究规划"
        desc="Gantt 图 · 写作时间线 · 周计划 · 投稿时间表"
        icon={Calendar}
      />

      <Tabs defaultValue="gantt">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="gantt">
            <Calendar className="h-3.5 w-3.5 mr-1.5" />
            Gantt 图
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <GitBranch className="h-3.5 w-3.5 mr-1.5" />
            进度时间线
          </TabsTrigger>
          <TabsTrigger value="writing">
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            写作时间线
          </TabsTrigger>
          <TabsTrigger value="weekly">
            <Target className="h-3.5 w-3.5 mr-1.5" />
            周计划
          </TabsTrigger>
          <TabsTrigger value="submission">
            <Award className="h-3.5 w-3.5 mr-1.5" />
            投稿时间表
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gantt"><GanttChart /></TabsContent>
        <TabsContent value="timeline"><ProgressTimeline /></TabsContent>
        <TabsContent value="writing"><WritingTimeline /></TabsContent>
        <TabsContent value="weekly"><WeeklyPlanner /></TabsContent>
        <TabsContent value="submission"><SubmissionScheduler /></TabsContent>
      </Tabs>
    </div>
  )
}

// ============ Gantt ============
function GanttChart() {
  const { data: milestones, refetch } = useFetch<Milestone[]>('/api/milestones?type=gantt')
  const api = useApi()
  const [addOpen, setAddOpen] = useState(false)
  const [newM, setNewM] = useState({ title: '', start: 0, end: 4, color: '#10b981', category: 'method' })

  const totalWeeks = 40

  const handleAdd = async () => {
    if (!newM.title.trim()) return
    try {
      await api.post('/api/milestones', {
        type: 'gantt',
        title: newM.title,
        startDate: String(newM.start),
        endDate: String(newM.end),
        duration: newM.end - newM.start,
        progress: 0,
        category: newM.category,
        color: newM.color,
      })
      toast.success('任务已添加')
      setAddOpen(false)
      setNewM({ title: '', start: 0, end: 4, color: '#10b981', category: 'method' })
      refetch()
    } catch {
      toast.error('添加失败')
    }
  }

  const handleProgress = async (m: Milestone, progress: number) => {
    try {
      await api.put(`/api/milestones/${m.id}`, { progress })
      refetch()
    } catch {
      toast.error('更新失败')
    }
  }

  const handleDelete = async (m: Milestone) => {
    if (!confirm(`删除「${m.title}」？`)) return
    try {
      await api.del(`/api/milestones/${m.id}`)
      toast.success('已删除')
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  return (
    <div className="space-y-3">
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground flex items-center justify-between">
          <div>
            📅 <strong className="text-blue-700 dark:text-blue-400">研究 Gantt 图</strong>
            （方法论 §1.4.2 gantt_chart.py）—— 40 周研究计划可视化
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5 mr-1" /> 添加任务
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>添加 Gantt 任务</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>任务名称</Label>
                  <Input value={newM.title} onChange={(e) => setNewM({ ...newM, title: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>开始周</Label>
                    <Input type="number" value={newM.start} onChange={(e) => setNewM({ ...newM, start: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>结束周</Label>
                    <Input type="number" value={newM.end} onChange={(e) => setNewM({ ...newM, end: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>分类</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={newM.category} onChange={(e) => setNewM({ ...newM, category: e.target.value })}>
                      <option value="survey">调研</option>
                      <option value="baseline">基线</option>
                      <option value="method">方法</option>
                      <option value="simulation">仿真</option>
                      <option value="experiment">实验</option>
                      <option value="writing">写作</option>
                      <option value="submission">投稿</option>
                    </select>
                  </div>
                  <div>
                    <Label>颜色</Label>
                    <input type="color" className="w-full h-9 rounded-md border border-input" value={newM.color} onChange={(e) => setNewM({ ...newM, color: e.target.value })} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
                <Button onClick={handleAdd}>添加</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          {/* Timeline header */}
          <div className="flex items-center mb-2">
            <div className="w-32 shrink-0 text-xs text-muted-foreground">任务</div>
            <div className="flex-1 grid grid-cols-10 gap-0 text-[9px] text-muted-foreground">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="text-center border-l border-border/40">{i * 4 + 1}-{(i + 1) * 4}</div>
              ))}
            </div>
          </div>

          {/* Gantt rows */}
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {milestones?.map((m) => {
              const start = Number(m.startDate)
              const end = Number(m.endDate)
              const left = (start / totalWeeks) * 100
              const width = ((end - start) / totalWeeks) * 100
              return (
                <div key={m.id} className="flex items-center group">
                  <div className="w-32 shrink-0 flex items-center gap-1 pr-2">
                    <span className="text-xs truncate flex-1" title={m.title}>{m.title}</span>
                    <button
                      onClick={() => handleDelete(m)}
                      className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex-1 relative h-7 bg-muted/30 rounded">
                    {/* Week grid lines */}
                    <div className="absolute inset-0 grid grid-cols-10">
                      {Array.from({ length: 10 }, (_, i) => (
                        <div key={i} className="border-l border-border/20" />
                      ))}
                    </div>
                    {/* Task bar */}
                    <div
                      className="absolute top-1 h-5 rounded flex items-center px-1.5 text-[10px] text-white font-medium overflow-hidden shadow-sm"
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 1.5)}%`,
                        background: m.color,
                      }}
                      title={`${m.title} (${start}-${end}周, 进度${m.progress}%)`}
                    >
                      <div className="absolute inset-y-0 left-0 bg-black/20 rounded-l" style={{ width: `${m.progress}%` }} />
                      <span className="relative z-10 truncate">{m.progress > 0 ? `${m.progress}%` : ''}</span>
                    </div>
                    {/* Progress controls on hover */}
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-0.5">
                      <button onClick={() => handleProgress(m, Math.max(0, m.progress - 25))} className="flex h-5 w-5 items-center justify-center rounded bg-background/80 text-[10px] hover:bg-background">−</button>
                      <button onClick={() => handleProgress(m, Math.min(100, m.progress + 25))} className="flex h-5 w-5 items-center justify-center rounded bg-background/80 text-[10px] hover:bg-background">+</button>
                    </div>
                  </div>
                </div>
              )
            })}
            {!milestones?.length && (
              <div className="text-center py-8 text-xs text-muted-foreground">暂无任务，点击右上角添加</div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-border">
            {[
              { c: '#3b82f6', n: '调研' },
              { c: '#10b981', n: '基线' },
              { c: '#ef4444', n: '方法' },
              { c: '#f59e0b', n: '仿真' },
              { c: '#8b5cf6', n: '实验' },
              { c: '#6366f1', n: '写作' },
              { c: '#ec4899', n: '投稿' },
              { c: '#6b7280', n: '答辩' },
            ].map((l) => (
              <div key={l.n} className="flex items-center gap-1 text-[10px]">
                <span className="h-2.5 w-2.5 rounded" style={{ background: l.c }} />
                <span className="text-muted-foreground">{l.n}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============ Writing Timeline ============
function WritingTimeline() {
  const { data: milestones, refetch } = useFetch<Milestone[]>('/api/milestones?type=writing')
  const [submissionDate, setSubmissionDate] = useState(() => {
    const today = new Date()
    today.setMonth(today.getMonth() + 3)
    return today.toISOString().slice(0, 10)
  })

  const computedMilestones = useMemo(() => {
    const sub = new Date(submissionDate)
    return WRITING_MILESTONES.map((m) => ({
      ...m,
      deadline: new Date(sub.getTime() - m.daysBefore * 86400000).toISOString().slice(0, 10),
    }))
  }, [submissionDate])

  // Match with DB milestones for progress
  const getProgress = (name: string) => {
    const db = milestones?.find((m) => m.title === name)
    return db?.progress ?? 0
  }

  const totalHours = WRITING_MILESTONES.reduce((sum, m) => sum + m.hours, 0)
  const totalDone = computedMilestones.reduce((sum, m) => sum + (getProgress(m.name) / 100) * m.hours, 0)
  const overallPct = (totalDone / totalHours) * 100

  return (
    <div className="space-y-3">
      <Card className="bg-purple-500/5 border-purple-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          ⏰ <strong className="text-purple-700 dark:text-purple-400">论文写作时间线</strong>
          （方法论 §5.2.1 writing_timeline.py）—— 6 周写一篇会议论文的倒推时间表
        </CardContent>
      </Card>

      {/* Submission date input */}
      <Card>
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <Label className="text-xs shrink-0">截稿日期：</Label>
          <Input
            type="date"
            value={submissionDate}
            onChange={(e) => setSubmissionDate(e.target.value)}
            className="w-auto h-9"
          />
          <Badge variant="outline" className="text-xs">总工时 {totalHours}h ({(totalHours / 40).toFixed(1)} 周)</Badge>
          <div className="flex-1 min-w-[120px]">
            <Progress value={overallPct} className="h-2" />
          </div>
          <Badge variant="secondary" className="text-xs bg-primary/15 text-primary">{overallPct.toFixed(0)}% 完成</Badge>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />

            <div className="space-y-4">
              {computedMilestones.map((m, i) => {
                const progress = getProgress(m.name)
                const isDone = progress >= 100
                const isInProgress = progress > 0 && progress < 100
                const daysLeft = Math.ceil((new Date(m.deadline).getTime() - Date.now()) / 86400000)
                return (
                  <div key={m.name} className="relative pl-10">
                    {/* Dot */}
                    <div
                      className={cn(
                        'absolute left-1.5 top-2 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background',
                        isDone ? 'bg-emerald-500' : isInProgress ? 'bg-amber-500' : 'bg-muted'
                      )}
                    >
                      {isDone && <span className="text-white text-[8px]">✓</span>}
                      {isInProgress && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                    </div>

                    <div className="rounded-md border border-border/60 p-2.5 hover:border-primary/40 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="text-sm font-medium">{m.name}</div>
                        <Badge variant="outline" className={cn('text-[10px]', daysLeft < 0 && 'bg-red-500/10 text-red-600')}>
                          {daysLeft > 0 ? `${daysLeft} 天后` : daysLeft === 0 ? '今天' : `已过 ${-daysLeft} 天`}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {m.deadline}
                        </span>
                        <span>·</span>
                        <span>距截稿 {m.daysBefore} 天</span>
                        <span>·</span>
                        <span>{m.hours}h 工作量</span>
                      </div>
                      <Progress value={progress} className="h-1" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-amber-500/5 border-amber-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          💡 <strong>积少成多策略</strong>（方法论 §5.2.2）：不要"集中写作"，每天写一点。上午读论文，下午写一段。4 周累计 40 小时 = 一篇合格会议论文。番茄工作法：25 分钟专注 → 5 分钟休息，每天 2-4 个番茄钟。
        </CardContent>
      </Card>
    </div>
  )
}

// ============ Weekly Planner ============
function WeeklyPlanner() {
  const [tasks, setTasks] = useState(WEEKLY_PLAN_TEMPLATE.map((t, i) => ({ ...t, id: i + 1, done: false })))
  const [newTask, setNewTask] = useState({ name: '', hours: 2, priority: 3 })

  const dayHours = [8, 8, 8, 8, 8, 4, 0]
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const totalHours = tasks.reduce((sum, t) => sum + (t.done ? 0 : t.hours), 0)
  const available = 44
  const overflow = totalHours > available

  // Assign tasks to days greedily
  const plan = useMemo(() => {
    const sorted = [...tasks].filter((t) => !t.done).sort((a, b) => b.priority - a.priority)
    const days = dayNames.map((n) => ({ name: n, items: [] as { name: string; hours: number; priority: number }[], remain: 0 }))
    days.forEach((d, i) => { d.remain = dayHours[i] })

    let taskIdx = 0
    for (const task of sorted) {
      let remaining = task.hours
      for (let i = 0; i < 7 && remaining > 0; i++) {
        if (days[i].remain > 0) {
          const alloc = Math.min(remaining, days[i].remain)
          days[i].items.push({ name: task.name, hours: alloc, priority: task.priority })
          days[i].remain -= alloc
          remaining -= alloc
        }
      }
    }
    return days
  }, [tasks])

  const addTask = () => {
    if (!newTask.name.trim()) return
    setTasks([...tasks, { ...newTask, id: Date.now(), done: false }])
    setNewTask({ name: '', hours: 2, priority: 3 })
  }

  const removeTask = (id: number) => setTasks(tasks.filter((t) => t.id !== id))
  const toggleTask = (id: number) => setTasks(tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t))

  return (
    <div className="space-y-3">
      <Card className="bg-emerald-500/5 border-emerald-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          📋 <strong className="text-emerald-700 dark:text-emerald-400">科研周计划</strong>
          （方法论 §4.4.3 research_planner.py）—— 按优先级自动分配每日任务
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{tasks.filter((t) => t.done).length}</div>
            <div className="text-[10px] text-muted-foreground">已完成任务</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className={cn('text-2xl font-bold', overflow ? 'text-red-600' : 'text-amber-600')}>{totalHours}h</div>
            <div className="text-[10px] text-muted-foreground">剩余工时</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{available}h</div>
            <div className="text-[10px] text-muted-foreground">本周可用</div>
          </CardContent>
        </Card>
      </div>

      {overflow && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="p-3 text-xs text-red-700 dark:text-red-400">
            ⚠ 超时 {totalHours - available}h，建议削减低优先级任务
          </CardContent>
        </Card>
      )}

      {/* Add task */}
      <Card>
        <CardContent className="p-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">任务名</Label>
              <Input value={newTask.name} onChange={(e) => setNewTask({ ...newTask, name: e.target.value })} className="h-8 text-xs" onKeyDown={(e) => e.key === 'Enter' && addTask()} />
            </div>
            <div className="w-20">
              <Label className="text-xs">小时</Label>
              <Input type="number" value={newTask.hours} onChange={(e) => setNewTask({ ...newTask, hours: Number(e.target.value) })} className="h-8 text-xs" />
            </div>
            <div className="w-20">
              <Label className="text-xs">优先级</Label>
              <Input type="number" min="1" max="5" value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: Number(e.target.value) })} className="h-8 text-xs" />
            </div>
            <Button size="sm" className="h-8" onClick={addTask}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Task list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">任务列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md border border-border/60 p-2">
              <input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} className="accent-primary" />
              <span className={cn('text-xs flex-1', t.done && 'line-through text-muted-foreground')}>{t.name}</span>
              <Badge variant="outline" className="text-[10px]">{t.hours}h</Badge>
              <Badge variant="secondary" className={cn('text-[10px]', t.priority >= 4 ? 'bg-red-500/15 text-red-600' : t.priority >= 3 ? 'bg-amber-500/15 text-amber-600' : 'bg-muted')}>P{t.priority}</Badge>
              <button onClick={() => removeTask(t.id)} className="text-destructive hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Weekly plan grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">本周计划（按优先级自动分配）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
            {plan.map((day) => (
              <div key={day.name} className="rounded-md border border-border/60 p-2 min-h-[100px]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-semibold">{day.name}</div>
                  <Badge variant="outline" className="text-[9px]">{dayHours[dayNames.indexOf(day.name)]}h</Badge>
                </div>
                <div className="space-y-1">
                  {day.items.map((item, i) => (
                    <div key={i} className="rounded bg-primary/10 p-1 text-[10px]">
                      <div className="font-medium text-primary truncate">{item.name}</div>
                      <div className="text-muted-foreground">{item.hours}h · P{item.priority}</div>
                    </div>
                  ))}
                  {day.items.length === 0 && (
                    <div className="text-[10px] text-muted-foreground text-center py-2">休息</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============ Submission Scheduler ============
function SubmissionScheduler() {
  const { data: milestones, refetch } = useFetch<Milestone[]>('/api/milestones?type=submission')
  const api = useApi()
  const [addOpen, setAddOpen] = useState(false)
  const [newSub, setNewSub] = useState({ title: '', targetVenue: 'IEEE ICC', startDate: '', endDate: '' })

  const handleAdd = async () => {
    if (!newSub.title.trim()) return
    try {
      await api.post('/api/milestones', {
        type: 'submission',
        title: newSub.title,
        targetVenue: newSub.targetVenue,
        startDate: newSub.startDate,
        endDate: newSub.endDate,
        duration: 0,
        progress: 0,
        category: 'submission',
        color: '#ec4899',
      })
      toast.success('投稿计划已添加')
      setAddOpen(false)
      setNewSub({ title: '', targetVenue: 'IEEE ICC', startDate: '', endDate: '' })
      refetch()
    } catch {
      toast.error('添加失败')
    }
  }

  const handleDelete = async (m: Milestone) => {
    if (!confirm(`删除「${m.title}」？`)) return
    try {
      await api.del(`/api/milestones/${m.id}`)
      toast.success('已删除')
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleStatus = async (m: Milestone, progress: number) => {
    try {
      await api.put(`/api/milestones/${m.id}`, { progress })
      refetch()
    } catch {
      toast.error('更新失败')
    }
  }

  const statusLabels: Record<number, { label: string; color: string }> = {
    0: { label: '准备中', color: 'bg-amber-500/15 text-amber-600' },
    25: { label: '撰写中', color: 'bg-blue-500/15 text-blue-600' },
    50: { label: '已投稿', color: 'bg-purple-500/15 text-purple-600' },
    75: { label: '审稿中', color: 'bg-cyan-500/15 text-cyan-600' },
    100: { label: '已录用', color: 'bg-emerald-500/15 text-emerald-600' },
  }

  return (
    <div className="space-y-3">
      <Card className="bg-pink-500/5 border-pink-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground flex items-center justify-between">
          <div>
            🏆 <strong className="text-pink-700 dark:text-pink-400">投稿时间表</strong>
            （方法论 §6.1.2 submission_scheduler.py）—— 跟踪每篇论文的投稿进度
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5 mr-1" /> 新增投稿
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新增投稿计划</DialogTitle>
                <DialogDescription>方法论 §6.1 投稿策略</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>论文标题</Label>
                  <Input value={newSub.title} onChange={(e) => setNewSub({ ...newSub, title: e.target.value })} />
                </div>
                <div>
                  <Label>目标会议/期刊</Label>
                  <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={newSub.targetVenue} onChange={(e) => setNewSub({ ...newSub, targetVenue: e.target.value })}>
                    {VENUES.map((v) => (
                      <option key={v.name} value={v.name}>{v.name} ({v.level})</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>开始日期</Label>
                    <Input type="date" value={newSub.startDate} onChange={(e) => setNewSub({ ...newSub, startDate: e.target.value })} />
                  </div>
                  <div>
                    <Label>截稿日期</Label>
                    <Input type="date" value={newSub.endDate} onChange={(e) => setNewSub({ ...newSub, endDate: e.target.value })} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
                <Button onClick={handleAdd}>添加</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Submission ladder theory */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">硕士阶段投稿阶梯</CardTitle>
          <CardDescription className="text-xs">方法论 §6.1.1</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex-1 rounded-md border border-border p-2 text-center">
              <div className="font-semibold">① 小论文练手</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">IEEE CL / ACCESS / 国内核心</div>
            </div>
            <GitCommitHorizontal className="h-4 w-4 text-muted-foreground rotate-90" />
            <div className="flex-1 rounded-md border border-border p-2 text-center">
              <div className="font-semibold">② 旗舰会议</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">IEEE ICC / GLOBECOM</div>
            </div>
            <GitCommitHorizontal className="h-4 w-4 text-muted-foreground rotate-90" />
            <div className="flex-1 rounded-md border border-border p-2 text-center">
              <div className="font-semibold">③ 顶级期刊</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">IEEE TCOM / TWC / TVT</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submissions */}
      <div className="space-y-2">
        {!milestones || milestones.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">暂无投稿计划</CardContent></Card>
        ) : (
          milestones.map((m) => {
            const status = statusLabels[m.progress] ?? statusLabels[0]
            const venueInfo = VENUES.find((v) => v.name === m.targetVenue)
            const daysLeft = m.endDate ? Math.ceil((new Date(m.endDate).getTime() - Date.now()) / 86400000) : null
            return (
              <Card key={m.id}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{m.title}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="secondary" className={cn('text-[10px]', status.color)}>{status.label}</Badge>
                        <Badge variant="outline" className="text-[10px]">{m.targetVenue}</Badge>
                        {venueInfo && <span className="text-[10px] text-muted-foreground">{venueInfo.reviewCycle}</span>}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => handleDelete(m)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground">
                    {m.startDate && <span>开始: {m.startDate}</span>}
                    {m.endDate && <span>· 截稿: {m.endDate}</span>}
                    {daysLeft !== null && daysLeft > 0 && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                        <Clock className="h-2.5 w-2.5 mr-0.5" />{daysLeft} 天
                      </Badge>
                    )}
                  </div>
                  <Progress value={m.progress} className="h-1.5 mb-2" />
                  <div className="flex gap-1">
                    {Object.keys(statusLabels).map((p) => (
                      <button
                        key={p}
                        onClick={() => handleStatus(m, Number(p))}
                        className={cn(
                          'flex-1 text-[10px] py-1 rounded border transition-colors',
                          m.progress === Number(p)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border hover:border-primary/40'
                        )}
                      >
                        {statusLabels[Number(p)].label}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          💡 <strong>推荐策略</strong>（方法论 §6.1.3）：<strong>"会议首发 → 期刊扩展"</strong>——
          Step 1: ICC/GLOBECOM 投稿（6页）→ Step 2: 根据反馈大改 → Step 3: 扩展 50% 以上新内容 → TCOM/TWC（12-14页）。
          优势：会议周期短得反馈快，期刊要求"显著扩展"正好利用反馈，毕业前可累积 2 篇论文。
        </CardContent>
      </Card>
    </div>
  )
}
