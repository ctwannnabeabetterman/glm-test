'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState, useMemo, useCallback } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { WRITING_MILESTONES, WEEKLY_PLAN_TEMPLATE, VENUES } from '@/lib/methodology-data'
import {
  Calendar,
  Plus,
  Trash2,
  Clock,
  TrendingUp,
  Award,
  Target,
  GitCommitHorizontal,
  GitBranch,
  RefreshCw,
  Settings2,
  Download,
  Link2,
  AlertTriangle,
  CalendarDays,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ProgressTimeline } from '@/components/progress-timeline'
import { ProgressStepper } from '@/components/planner/progress-stepper'
import { CalendarView } from '@/components/planner/calendar-view'
import { AiPlannerAssistant } from '@/components/planner/ai-assistant'
import { downloadFromApi } from '@/lib/download'
import { DAY_NAMES, DEFAULT_PROJECT_CONFIG, totalWeeklyHours, type ProjectConfig } from '@/lib/planner/config'
import {
  allocateWeeklyPlan,
  remainingHours,
  resolveWeekStart,
  weekRangeLabel,
  weeksSince,
  type PlanTaskInput,
} from '@/lib/planner/schedule'
import {
  DEVIATION_STATE_LABELS,
  type Deviation,
  type DeviationSummary,
  type DeviationState,
} from '@/lib/planner/linkage'

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
  actualEndDate: string
  refType: string
  refId: string
  autoProgress: boolean
  /** 由 /api/milestones 附带解析出来的关联名与可推进进度 */
  refLabel?: string
  derivedProgress?: number | null
}

interface ProjectConfigResponse extends ProjectConfig {
  weeklyHours: number
}

interface WeeklyTask {
  id: string
  name: string
  hours: number
  priority: number
  done: boolean
  weekStart: string
  order: number
}

interface WeeklyTasksResponse {
  weekStart: string
  tasks: WeeklyTask[]
}

interface DeviationResponse {
  projectStart: string
  generatedAt: string
  rows: Deviation[]
  summary: DeviationSummary
}

/** Gantt 图固定的 40 周视野 */
const TOTAL_WEEKS = 40

export function PlannerSection() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="研究规划"
        desc="Gantt 图 · 进度时间线 · 写作时间线 · 周计划 · 投稿时间表 · 计划 vs 实际 · 日历 · AI 助手"
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
          <TabsTrigger value="deviation">
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            计划 vs 实际
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
            日历
          </TabsTrigger>
          <TabsTrigger value="assistant">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            AI 助手
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gantt"><GanttChart /></TabsContent>
        <TabsContent value="timeline"><ProgressTimeline /></TabsContent>
        <TabsContent value="writing"><WritingTimeline /></TabsContent>
        <TabsContent value="weekly"><WeeklyPlanner /></TabsContent>
        <TabsContent value="submission"><SubmissionScheduler /></TabsContent>
        <TabsContent value="deviation"><DeviationReport /></TabsContent>
        <TabsContent value="calendar"><CalendarView /></TabsContent>
        <TabsContent value="assistant"><AiPlannerAssistant /></TabsContent>
      </Tabs>
    </div>
  )
}

// ============ 项目设置（起始日 + 每日可用工时） ============

function ProjectSettingsDialog({
  config,
  onSaved,
  trigger,
}: {
  config: ProjectConfigResponse | null
  onSaved: () => void
  trigger: React.ReactNode
}) {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [dailyHours, setDailyHours] = useState<number[]>([...DEFAULT_PROJECT_CONFIG.dailyHours])
  const [saving, setSaving] = useState(false)

  const openDialog = (next: boolean) => {
    if (next) {
      setStartDate(config?.startDate ?? '')
      setDailyHours(config?.dailyHours?.length === 7 ? [...config.dailyHours] : [...DEFAULT_PROJECT_CONFIG.dailyHours])
    }
    setOpen(next)
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/settings/project', { startDate, dailyHours })
      toast.success('项目设置已保存')
      setOpen(false)
      onSaved()
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const weekly = dailyHours.reduce((sum, h) => sum + (Number(h) || 0), 0)

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>项目设置</DialogTitle>
          <DialogDescription>
            甘特图里的「第 N 周」需要一个起点才能变成真实日期，也才能判断当前进度是快了还是慢了。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>项目起始日（第 1 周的周一）</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <p className="text-[11px] text-muted-foreground mt-1">
              留空则甘特图只显示周序号，不出日期、不计算偏差。
            </p>
          </div>
          <div>
            <Label>每周每日可用工时</Label>
            <div className="grid grid-cols-7 gap-1.5 mt-1">
              {DAY_NAMES.map((name, i) => (
                <div key={name}>
                  <div className="text-[10px] text-muted-foreground text-center mb-1">{name}</div>
                  <Input
                    type="number"
                    min={0}
                    max={16}
                    value={dailyHours[i]}
                    onChange={(e) => {
                      const next = [...dailyHours]
                      next[i] = Number(e.target.value)
                      setDailyHours(next)
                    }}
                    className="h-8 text-xs text-center px-1"
                  />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">合计 {weekly} 小时/周</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============ Gantt ============

function GanttChart() {
  const { data: config, refetch: refetchConfig } = useFetch<ProjectConfigResponse>('/api/settings/project')
  const { data: milestones, refetch } = useFetch<Milestone[]>('/api/milestones?type=gantt')
  const { data: experiments } = useFetch<{ id: string; name: string; status: string }[]>('/api/experiments')
  const { data: manuscripts } = useFetch<{ id: string; title: string; status: string }[]>('/api/writing/manuscripts')
  const api = useApi()
  const [addOpen, setAddOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [newM, setNewM] = useState({
    title: '',
    start: 0,
    end: 4,
    color: '#10b981',
    category: 'method',
    ref: '',
    autoProgress: true,
  })

  const projectStart = config?.startDate ?? ''
  const hasStart = Boolean(projectStart)
  const currentWeek = hasStart ? weeksSince(projectStart, new Date()) : null
  const cursorPct =
    currentWeek !== null && currentWeek >= 0 && currentWeek < TOTAL_WEEKS
      ? ((currentWeek + 0.5) / TOTAL_WEEKS) * 100
      : null

  const refOptions = useMemo(() => {
    const list: { value: string; label: string; status: string }[] = []
    for (const e of experiments ?? []) list.push({ value: `experiment:${e.id}`, label: `实验 · ${e.name}`, status: e.status })
    for (const m of manuscripts ?? []) list.push({ value: `manuscript:${m.id}`, label: `稿件 · ${m.title}`, status: m.status })
    return list
  }, [experiments, manuscripts])

  const handleAdd = async () => {
    if (!newM.title.trim()) return
    const [refType, refId] = newM.ref ? newM.ref.split(':') : ['', '']
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
        refType,
        refId,
        autoProgress: refType ? newM.autoProgress : false,
      })
      toast.success('任务已添加')
      setAddOpen(false)
      setNewM({ title: '', start: 0, end: 4, color: '#10b981', category: 'method', ref: '', autoProgress: true })
      refetch()
    } catch {
      toast.error('添加失败')
    }
  }

  const handleProgress = useCallback(
    async (m: Milestone, progress: number) => {
      try {
        await api.put(`/api/milestones/${m.id}`, { progress })
        refetch()
      } catch {
        toast.error('更新失败')
      }
    },
    [api, refetch],
  )

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

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = (await api.post('/api/planner/sync', {})) as {
        changed: number
        suggestions?: { title: string }[]
      }
      const extra = res.suggestions?.length ? `，另有 ${res.suggestions.length} 条待你确认` : ''
      toast.success(res.changed ? `已推进 ${res.changed} 个里程碑${extra}` : `没有需要推进的里程碑${extra}`)
      refetch()
    } catch {
      toast.error('同步失败')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-3">
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span>📅 <strong className="text-blue-700 dark:text-blue-400">研究 Gantt 图</strong> · 40 周研究计划</span>
            {hasStart ? (
              <Badge variant="outline" className="text-[10px]">
                起点 {projectStart}
                {currentWeek !== null && currentWeek >= 0 && ` · 当前第 ${currentWeek + 1} 周`}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600">
                未设起始日 —— 无法换算真实日期
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ProjectSettingsDialog
              config={config}
              onSaved={refetchConfig}
              trigger={
                <Button size="sm" variant="ghost">
                  <Settings2 className="h-3.5 w-3.5 mr-1" /> 项目设置
                </Button>
              }
            />
            <Button size="sm" variant="ghost" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1', syncing && 'animate-spin')} /> 同步实验/稿件
            </Button>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="h-3.5 w-3.5 mr-1" /> 添加任务
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>添加 Gantt 任务</DialogTitle>
                  <DialogDescription>周序号从 0 开始计，第 1 周 = 0</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>任务名称</Label>
                    <Input value={newM.title} onChange={(e) => setNewM({ ...newM, title: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>开始周</Label>
                      <Input type="number" min={0} max={TOTAL_WEEKS} value={newM.start} onChange={(e) => setNewM({ ...newM, start: Number(e.target.value) })} />
                    </div>
                    <div>
                      <Label>结束周</Label>
                      <Input type="number" min={0} max={TOTAL_WEEKS} value={newM.end} onChange={(e) => setNewM({ ...newM, end: Number(e.target.value) })} />
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
                        <option value="analysis">结果分析</option>
                        <option value="writing">写作</option>
                        <option value="submission">投稿</option>
                        <option value="defense">答辩</option>
                      </select>
                    </div>
                    <div>
                      <Label>颜色</Label>
                      <input type="color" className="w-full h-9 rounded-md border border-input" value={newM.color} onChange={(e) => setNewM({ ...newM, color: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label>关联实验 / 稿件（可选）</Label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={newM.ref}
                      onChange={(e) => setNewM({ ...newM, ref: e.target.value })}
                    >
                      <option value="">不关联</option>
                      {refOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}（{o.status}）</option>
                      ))}
                    </select>
                    {newM.ref && (
                      <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={newM.autoProgress}
                          onChange={(e) => setNewM({ ...newM, autoProgress: e.target.checked })}
                        />
                        允许「同步实验/稿件」时按来源自动推进进度（只推进、不回退）
                      </label>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
                  <Button onClick={handleAdd}>添加</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          {/* 时间轴表头 */}
          <div className="flex items-end mb-2">
            <div className="w-44 shrink-0 text-xs text-muted-foreground">任务</div>
            <div className="flex-1 grid grid-cols-10 gap-0 text-[9px] text-muted-foreground">
              {Array.from({ length: 10 }, (_, i) => {
                const range = hasStart ? weekRangeLabel(projectStart, i * 4, i * 4 + 3) : null
                return (
                  <div key={i} className="text-center border-l border-border/40 leading-tight">
                    <div>{i * 4 + 1}-{(i + 1) * 4} 周</div>
                    {range && <div className="text-[8px] opacity-70">{range}</div>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Gantt 行 */}
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {milestones?.map((m) => {
              const start = Number(m.startDate)
              const end = Number(m.endDate)
              const left = (start / TOTAL_WEEKS) * 100
              const width = ((end - start) / TOTAL_WEEKS) * 100
              const range = hasStart ? weekRangeLabel(projectStart, start, end) : null
              const canSync = m.derivedProgress !== null && m.derivedProgress !== undefined && m.derivedProgress > m.progress
              return (
                <div key={m.id} className="flex items-center group">
                  <div className="w-44 shrink-0 pr-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs truncate flex-1" title={m.title}>{m.title}</span>
                      <button
                        onClick={() => handleDelete(m)}
                        aria-label={`删除 ${m.title}`}
                        className="opacity-0 group-hover:opacity-100 text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      第 {start + 1}-{end} 周{range ? ` · ${range}` : ''}
                    </div>
                    {m.refLabel && (
                      <div className={cn('text-[9px] truncate flex items-center gap-0.5', canSync ? 'text-amber-600' : 'text-muted-foreground')}>
                        <Link2 className="h-2.5 w-2.5 shrink-0" />
                        {m.refLabel}
                        {canSync && ` · 可推进到 ${m.derivedProgress}%`}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 relative h-9 bg-muted/30 rounded">
                    <div className="absolute inset-0 grid grid-cols-10">
                      {Array.from({ length: 10 }, (_, i) => (
                        <div key={i} className="border-l border-border/20" />
                      ))}
                    </div>
                    {cursorPct !== null && (
                      <div className="absolute inset-y-0 w-px bg-primary/60 z-20" style={{ left: `${cursorPct}%` }} title="当前周" />
                    )}
                    <div
                      className="absolute top-1 h-5 rounded flex items-center px-1.5 text-[10px] text-white font-medium overflow-hidden shadow-sm"
                      style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%`, background: m.color }}
                      title={`${m.title}（第 ${start + 1}-${end} 周，进度 ${m.progress}%）`}
                    >
                      <div className="absolute inset-y-0 left-0 bg-black/20 rounded-l" style={{ width: `${m.progress}%` }} />
                      <span className="relative z-10 truncate">{m.progress > 0 ? `${m.progress}%` : ''}</span>
                    </div>
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-0.5 items-center">
                      <ProgressStepper progress={m.progress} onCommit={(next) => handleProgress(m, next)} />
                    </div>
                  </div>
                </div>
              )
            })}
            {!milestones?.length && (
              <div className="text-center py-8 text-xs text-muted-foreground">暂无任务，点击右上角添加</div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-border">
            {[
              { c: '#3b82f6', n: '调研' },
              { c: '#10b981', n: '基线' },
              { c: '#ef4444', n: '方法' },
              { c: '#f59e0b', n: '仿真' },
              { c: '#8b5cf6', n: '实验' },
              { c: '#06b6d4', n: '结果分析' },
              { c: '#6366f1', n: '写作' },
              { c: '#ec4899', n: '投稿' },
              { c: '#6b7280', n: '答辩' },
            ].map((l) => (
              <div key={l.n} className="flex items-center gap-1 text-[10px]">
                <span className="h-2.5 w-2.5 rounded" style={{ background: l.c }} />
                <span className="text-muted-foreground">{l.n}</span>
              </div>
            ))}
            {cursorPct !== null && (
              <div className="flex items-center gap-1 text-[10px] ml-auto">
                <span className="h-3 w-px bg-primary" />
                <span className="text-muted-foreground">当前周</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============ Writing Timeline ============

function WritingTimeline() {
  const { data: milestones, refetch } = useFetch<Milestone[]>('/api/milestones?type=writing')
  const api = useApi()
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

  // 与数据库里的写作里程碑按标题对齐 —— 进度现在可以从这里写回去了
  const matchDb = (name: string) => milestones?.find((m) => m.title === name) ?? null

  const handleProgress = useCallback(
    async (id: string, next: number) => {
      try {
        await api.put(`/api/milestones/${id}`, { progress: next })
        refetch()
      } catch {
        toast.error('更新失败')
      }
    },
    [api, refetch],
  )

  const totalHours = WRITING_MILESTONES.reduce((sum, m) => sum + m.hours, 0)
  const totalDone = computedMilestones.reduce((sum, m) => {
    const db = matchDb(m.name)
    return sum + ((db?.progress ?? 0) / 100) * m.hours
  }, 0)
  const overallPct = totalHours ? (totalDone / totalHours) * 100 : 0

  const linkedCount = WRITING_MILESTONES.filter((m) => matchDb(m.name)).length

  return (
    <div className="space-y-3">
      <Card className="bg-purple-500/5 border-purple-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          ⏰ <strong className="text-purple-700 dark:text-purple-400">论文写作时间线</strong>
          （方法论 §5.2.1）—— 6 周写一篇会议论文的倒推时间表。已匹配 {linkedCount}/{WRITING_MILESTONES.length} 个里程碑。
        </CardContent>
      </Card>

      {linkedCount < WRITING_MILESTONES.length && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              有 {WRITING_MILESTONES.length - linkedCount} 个写作里程碑在库里还没有对应记录，进度无法记录。
              请到「系统设置」或重新初始化示例数据后再试（写作里程碑由示例数据创建）。
            </span>
          </CardContent>
        </Card>
      )}

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

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-border" />
            <div className="space-y-4">
              {computedMilestones.map((m) => {
                const db = matchDb(m.name)
                const progress = db?.progress ?? 0
                const isDone = progress >= 100
                const isInProgress = progress > 0 && progress < 100
                const daysLeft = Math.ceil((new Date(m.deadline).getTime() - Date.now()) / 86400000)
                return (
                  <div key={m.name} className="relative pl-10">
                    <div
                      className={cn(
                        'absolute left-1.5 top-2 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background',
                        isDone ? 'bg-emerald-500' : isInProgress ? 'bg-amber-500' : 'bg-muted',
                      )}
                    >
                      {isDone && <span className="text-white text-[8px]">✓</span>}
                      {isInProgress && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                    </div>

                    <div className="rounded-md border border-border/60 p-2.5 hover:border-primary/40 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={cn('text-[10px]', daysLeft < 0 && 'bg-red-500/10 text-red-600')}>
                            {daysLeft > 0 ? `${daysLeft} 天后` : daysLeft === 0 ? '今天' : `已过 ${-daysLeft} 天`}
                          </Badge>
                          {db ? (
                            <ProgressStepper progress={progress} onCommit={(next) => handleProgress(db.id, next)} />
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">无记录</Badge>
                          )}
                        </div>
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
          💡 <strong>积少成多策略</strong>（方法论 §5.2.2）：不要&quot;集中写作&quot;，每天写一点。上午读论文，下午写一段。4 周累计 40 小时 = 一篇合格会议论文。番茄工作法：25 分钟专注 → 5 分钟休息，每天 2-4 个番茄钟。
        </CardContent>
      </Card>
    </div>
  )
}

// ============ Weekly Planner ============

function TaskRow({
  task,
  onToggle,
  onRemove,
  onPatch,
}: {
  task: WeeklyTask
  onToggle: () => void
  onRemove: () => void
  onPatch: (patch: Partial<Pick<WeeklyTask, 'hours' | 'priority'>>) => void
}) {
  const [hours, setHours] = useState(String(task.hours))
  const [priority, setPriority] = useState(String(task.priority))

  const commitHours = () => {
    const n = Number(hours)
    if (!Number.isFinite(n) || n === task.hours) {
      setHours(String(task.hours))
      return
    }
    onPatch({ hours: n })
  }

  const commitPriority = () => {
    const n = Number(priority)
    if (!Number.isFinite(n) || n === task.priority) {
      setPriority(String(task.priority))
      return
    }
    onPatch({ priority: n })
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 p-2">
      <input type="checkbox" checked={task.done} onChange={onToggle} className="accent-primary" />
      <span className={cn('text-xs flex-1 min-w-0 truncate', task.done && 'line-through text-muted-foreground')} title={task.name}>
        {task.name}
      </span>
      <Input
        type="number"
        min={0}
        max={24}
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        onBlur={commitHours}
        className="h-7 w-14 text-[11px] px-1"
        aria-label="工时"
      />
      <Input
        type="number"
        min={1}
        max={5}
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
        onBlur={commitPriority}
        className="h-7 w-12 text-[11px] px-1"
        aria-label="优先级"
      />
      <button onClick={onRemove} aria-label={`删除 ${task.name}`} className="text-destructive">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

function WeeklyPlanner() {
  const weekStart = useMemo(() => resolveWeekStart(null), [])
  const { data: config } = useFetch<ProjectConfigResponse>('/api/settings/project')
  const { data, refetch, loading } = useFetch<WeeklyTasksResponse>(`/api/weekly-tasks?week=${weekStart}`)
  const api = useApi()
  const [newTask, setNewTask] = useState({ name: '', hours: 2, priority: 3 })
  const [adding, setAdding] = useState(false)

  const tasks = useMemo(() => data?.tasks ?? [], [data])
  const dailyHours = config?.dailyHours?.length === 7 ? config.dailyHours : DEFAULT_PROJECT_CONFIG.dailyHours
  const weeklyHours = config?.weeklyHours ?? totalWeeklyHours(DEFAULT_PROJECT_CONFIG)
  const totalHours = remainingHours(tasks)
  const overflow = totalHours > weeklyHours
  const doneCount = tasks.filter((t) => t.done).length
  const plan = useMemo(
    () => allocateWeeklyPlan(tasks as PlanTaskInput[], dailyHours),
    [tasks, dailyHours],
  )

  const addTask = async () => {
    if (!newTask.name.trim()) return
    setAdding(true)
    try {
      await api.post('/api/weekly-tasks', { ...newTask, weekStart })
      setNewTask({ name: '', hours: 2, priority: 3 })
      refetch()
    } catch {
      toast.error('添加失败')
    } finally {
      setAdding(false)
    }
  }

  const loadTemplate = async () => {
    setAdding(true)
    try {
      for (const t of WEEKLY_PLAN_TEMPLATE) {
        await api.post('/api/weekly-tasks', { name: t.name, hours: t.hours, priority: t.priority, weekStart })
      }
      toast.success(`已载入 ${WEEKLY_PLAN_TEMPLATE.length} 条模板任务`)
      refetch()
    } catch {
      toast.error('载入失败')
    } finally {
      setAdding(false)
    }
  }

  const toggleTask = async (task: WeeklyTask) => {
    try {
      await api.put(`/api/weekly-tasks/${task.id}`, { done: !task.done })
      refetch()
    } catch {
      toast.error('更新失败')
    }
  }

  const removeTask = async (task: WeeklyTask) => {
    try {
      await api.del(`/api/weekly-tasks/${task.id}`)
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  const patchTask = async (task: WeeklyTask, patch: Partial<Pick<WeeklyTask, 'hours' | 'priority'>>) => {
    try {
      await api.put(`/api/weekly-tasks/${task.id}`, patch)
      refetch()
    } catch {
      toast.error('更新失败')
    }
  }

  return (
    <div className="space-y-3">
      <Card className="bg-emerald-500/5 border-emerald-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
          <div>
            📋 <strong className="text-emerald-700 dark:text-emerald-400">科研周计划</strong>
            （方法论 §4.4.3）—— 按优先级自动分配每日任务
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">本周起始 {weekStart}</Badge>
            <Button size="sm" variant="ghost" onClick={loadTemplate} disabled={adding}>
              载入模板
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{doneCount}</div>
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
            <div className="text-2xl font-bold text-blue-600">{weeklyHours}h</div>
            <div className="text-[10px] text-muted-foreground">本周可用</div>
          </CardContent>
        </Card>
      </div>

      {overflow && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="p-3 text-xs text-red-700 dark:text-red-400">
            ⚠ 超时 {Math.round((totalHours - weeklyHours) * 10) / 10}h，建议削减低优先级任务
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">任务名</Label>
              <Input
                value={newTask.name}
                onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                className="h-8 text-xs"
                onKeyDown={(e) => e.key === 'Enter' && void addTask()}
              />
            </div>
            <div className="w-20">
              <Label className="text-xs">小时</Label>
              <Input type="number" value={newTask.hours} onChange={(e) => setNewTask({ ...newTask, hours: Number(e.target.value) })} className="h-8 text-xs" />
            </div>
            <div className="w-20">
              <Label className="text-xs">优先级</Label>
              <Input type="number" min="1" max="5" value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: Number(e.target.value) })} className="h-8 text-xs" />
            </div>
            <Button size="sm" className="h-8" onClick={addTask} disabled={adding}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">任务列表</CardTitle>
          <CardDescription className="text-xs">
            工时与优先级可直接改；勾选完成会自动重排本周计划
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {loading && <div className="text-xs text-muted-foreground text-center py-4">加载中…</div>}
          {!loading && !tasks.length && (
            <div className="text-xs text-muted-foreground text-center py-4">
              本周还没有任务 —— 可以在上面添加，或点「载入模板」
            </div>
          )}
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={() => void toggleTask(t)}
              onRemove={() => void removeTask(t)}
              onPatch={(patch) => void patchTask(t, patch)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">本周计划（按优先级自动分配）</CardTitle>
          <CardDescription className="text-xs">
            每日可用工时来自「项目设置」，当前 {dailyHours.join(' / ')} 小时
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
            {plan.map((day) => (
              <div key={day.name} className="rounded-md border border-border/60 p-2 min-h-[100px]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-semibold">{day.name}</div>
                  <Badge variant="outline" className="text-[9px]">{day.capacity}h</Badge>
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
            （方法论 §6.1.2）—— 跟踪每篇论文的投稿进度
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
                        {m.actualEndDate && (
                          <span className="text-[10px] text-emerald-600">录用日 {m.actualEndDate}</span>
                        )}
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
                            : 'border-border hover:border-primary/40',
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
          💡 <strong>推荐策略</strong>（方法论 §6.1.3）：<strong>&quot;会议首发 → 期刊扩展&quot;</strong>——
          Step 1: ICC/GLOBECOM 投稿（6页）→ Step 2: 根据反馈大改 → Step 3: 扩展 50% 以上新内容 → TCOM/TWC（12-14页）。
          优势：会议周期短得反馈快，期刊要求&quot;显著扩展&quot;正好利用反馈，毕业前可累积 2 篇论文。
        </CardContent>
      </Card>
    </div>
  )
}

// ============ 计划 vs 实际（D3） ============

const DEVIATION_FILTERS: { value: 'all' | DeviationState; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'behind', label: '落后' },
  { value: 'in-progress', label: '进行中' },
  { value: 'on-time', label: '按时' },
  { value: 'ahead', label: '提前' },
  { value: 'unknown', label: '无法判定' },
]

function DeviationReport() {
  const [filter, setFilter] = useState<'all' | DeviationState>('all')
  const { data, loading, refetch } = useFetch<DeviationResponse>('/api/planner/deviations')
  const [exporting, setExporting] = useState(false)

  const rows = useMemo(() => data?.rows ?? [], [data])
  const filtered = filter === 'all' ? rows : rows.filter((r) => r.state === filter)
  const summary = data?.summary

  const exportMd = async () => {
    setExporting(true)
    try {
      await downloadFromApi('/api/planner/deviations?format=md', '研究进度偏差报告.md')
      toast.success('已导出偏差报告')
    } catch {
      toast.error('导出失败')
    } finally {
      setExporting(false)
    }
  }

  const stateColor: Record<DeviationState, string> = {
    ahead: 'bg-emerald-500/15 text-emerald-600',
    'on-time': 'bg-blue-500/15 text-blue-600',
    behind: 'bg-red-500/15 text-red-600',
    'in-progress': 'bg-amber-500/15 text-amber-600',
    unknown: 'bg-muted text-muted-foreground',
  }

  return (
    <div className="space-y-3">
      <Card className="bg-cyan-500/5 border-cyan-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
          <div>
            📊 <strong className="text-cyan-700 dark:text-cyan-400">计划 vs 实际</strong>
            —— 每个里程碑的计划完成日与实际完成日的偏差
            {data?.projectStart ? ` · 项目起点 ${data.projectStart}` : ' · 未设项目起始日（甘特里程碑无法计算）'}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> 刷新
            </Button>
            <Button size="sm" variant="outline" onClick={exportMd} disabled={exporting}>
              <Download className="h-3.5 w-3.5 mr-1" /> 导出 Markdown
            </Button>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold">{summary.total}</div>
              <div className="text-[10px] text-muted-foreground">里程碑总数</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-emerald-600">{summary.done}</div>
              <div className="text-[10px] text-muted-foreground">已完成</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-red-600">{summary.behind}</div>
              <div className="text-[10px] text-muted-foreground">落后</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">
                {summary.avgDeviationDays === null ? '—' : `${summary.avgDeviationDays}`}
              </div>
              <div className="text-[10px] text-muted-foreground">平均偏差（天）</div>
            </CardContent>
          </Card>
        </div>
      )}

      {summary && summary.worst.length > 0 && (
        <Card className="bg-red-500/5 border-red-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-600" /> 最需要处理的
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {summary.worst.map((w) => (
              <div key={w.id} className="flex items-center justify-between text-xs">
                <span className="truncate">{w.title}</span>
                <span className="text-red-600 shrink-0 ml-2">
                  {w.deviationDays !== null && w.deviationDays > 0 ? `晚 ${w.deviationDays} 天` : DEVIATION_STATE_LABELS[w.state]}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-muted-foreground">筛选:</span>
        {DEVIATION_FILTERS.map((f) => {
          const count = f.value === 'all' ? rows.length : rows.filter((r) => r.state === f.value).length
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
                filter === f.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40',
              )}
            >
              {f.label} ({count})
            </button>
          )
        })}
      </div>

      {loading && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">加载偏差数据…</CardContent></Card>}

      {!loading && (
        <div className="space-y-2">
          {filtered.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                没有符合条件的里程碑
              </CardContent>
            </Card>
          )}
          {filtered.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.title}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">{r.type}</Badge>
                      <span>计划完成 {r.plannedEnd ?? '—'}</span>
                      <span>· 实际完成 {r.actualEnd ?? '—'}</span>
                      {r.deviationDays !== null && (
                        <span className={cn(r.deviationDays > 0 ? 'text-red-600' : 'text-emerald-600')}>
                          · {r.deviationDays > 0 ? `晚 ${r.deviationDays} 天` : r.deviationDays < 0 ? `早 ${-r.deviationDays} 天` : '当天完成'}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary" className={cn('text-[10px] shrink-0', stateColor[r.state])}>
                    {DEVIATION_STATE_LABELS[r.state]}
                  </Badge>
                </div>
                <Progress value={r.progress} className="h-1.5" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
