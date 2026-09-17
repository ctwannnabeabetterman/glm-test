'use client'

/**
 * AI 规划助手（D4）。
 *
 * 两条刻意的设计：
 *  1. **生成结果不自动写库**。点「生成」只展示，用户确认后再点「写入本周计划」——
 *     写进去的就是他在屏幕上看到的那几条（不重新问一次模型，否则两次结果对不上，
 *     而库里已经躺了上一份，没人能解释那些任务从哪来）。
 *  2. **错误要能行动**。这里刻意不走 `useApi`（它只抛 `HTTP 400`），
 *     而是自己读响应体：没配 API Key 时后端回 `code: LLM_NOT_CONFIGURED`，
 *     前端据此给出「去设置里填 API Key」的按钮，而不是甩用户一句 400。
 */

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useApi, useFetch } from '@/lib/hooks'
import { useAppStore } from '@/lib/store'
import { toast } from 'sonner'
import { resolveWeekStart } from '@/lib/planner/schedule'
import { ASSIST_MODE_LABELS, type AssistMode } from '@/lib/planner/ai'
import { Sparkles, AlertTriangle, RefreshCw, Wand2, Plus, Check } from 'lucide-react'

interface Milestone {
  id: string
  title: string
  progress: number
}

interface WeeklyTasksResponse {
  weekStart: string
  tasks: { id: string; name: string }[]
}

interface ProjectConfigResponse {
  weeklyHours: number
  startDate: string
}

interface AssistResponse {
  success: boolean
  mode: AssistMode
  weekStart: string
  content: string
  tasks: { name: string; hours: number; priority: number }[]
  parseError: string | null
}

const ASSIST_MODE_HINTS: Record<AssistMode, string> = {
  weekly: '按当前进度与本周可用工时，生成一份可直接落地的周计划',
  risk: '拿计划 / 实际的偏差做一次进度评审，指出真正该处理的风险',
  breakdown: '把某个里程碑拆成有先后顺序、能逐步交付的小任务',
}

export function AiPlannerAssistant() {
  const weekStart = useMemo(() => resolveWeekStart(null), [])
  const { data: milestones, refetch: refetchMilestones } = useFetch<Milestone[]>('/api/milestones')
  const { data: weekly, refetch: refetchWeekly } = useFetch<WeeklyTasksResponse>(`/api/weekly-tasks?week=${weekStart}`)
  const { data: config } = useFetch<ProjectConfigResponse>('/api/settings/project')
  const api = useApi()
  const setSection = useAppStore((s) => s.setSection)

  const [mode, setMode] = useState<AssistMode>('weekly')
  const [goal, setGoal] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [running, setRunning] = useState(false)
  const [writing, setWriting] = useState(false)
  const [result, setResult] = useState<AssistResponse | null>(null)
  const [error, setError] = useState<{ message: string; needsConfig: boolean } | null>(null)
  const [writtenCount, setWrittenCount] = useState(0)

  const unfinished = useMemo(() => (milestones ?? []).filter((m) => m.progress < 100), [milestones])

  const run = async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    setWrittenCount(0)
    try {
      const res = await fetch('/api/planner/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, goal, weekStart, milestoneId: milestoneId || undefined }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError({
          message: json?.error || `请求失败（HTTP ${res.status}）`,
          needsConfig: json?.code === 'LLM_NOT_CONFIGURED',
        })
        return
      }
      setResult(json as AssistResponse)
    } catch (e) {
      setError({ message: `请求失败：${(e as Error).message}`, needsConfig: false })
    } finally {
      setRunning(false)
    }
  }

  const writeToWeek = async () => {
    const tasks = result?.tasks ?? []
    if (!tasks.length) return
    setWriting(true)
    let done = 0
    try {
      for (const task of tasks) {
        await api.post('/api/weekly-tasks', { name: task.name, hours: task.hours, priority: task.priority, weekStart })
        done++
      }
      setWrittenCount(done)
      await Promise.all([refetchWeekly(), refetchMilestones()])
      toast.success(`已写入 ${done} 条到本周计划`)
    } catch {
      // 逐条写入，中途失败要说清成功了几条，不能假装全成功
      setWrittenCount(done)
      toast.error(`写入中断：已成功 ${done} / ${tasks.length} 条`)
    } finally {
      setWriting(false)
    }
  }

  const totalHours = result?.tasks.reduce((sum, t) => sum + t.hours, 0) ?? 0
  const capacity = config?.weeklyHours

  return (
    <div className="space-y-3">
      <Card className="bg-violet-500/5 border-violet-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 inline mr-1 text-violet-600" />
          <strong className="text-violet-700 dark:text-violet-400">AI 规划助手</strong>
          —— 把项目当前状态（里程碑进度、计划 / 实际偏差、本周已有任务）交给大模型，让它给建议。
          生成结果<strong>不会自动写库</strong>，你确认后再点「写入本周计划」。
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">选择要它做什么</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ASSIST_MODE_LABELS) as AssistMode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? 'default' : 'outline'}
                onClick={() => {
                  setMode(m)
                  setResult(null)
                  setError(null)
                }}
              >
                {ASSIST_MODE_LABELS[m]}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{ASSIST_MODE_HINTS[mode]}</p>

          {mode === 'breakdown' && (
            <div className="space-y-1">
              <Label className="text-xs">拆解哪个里程碑</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
                value={milestoneId}
                onChange={(e) => setMilestoneId(e.target.value)}
              >
                <option value="">（自动选第一个未完成的）</option>
                {unfinished.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} · 当前 {m.progress}%
                  </option>
                ))}
              </select>
              {unfinished.length === 0 && (
                <p className="text-[11px] text-amber-600">没有未完成的里程碑，没什么可拆的。</p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">补充要求（可选）</Label>
            <Input
              placeholder="例如：这周要准备组会汇报，实验时间少一点"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>

          <Button size="sm" onClick={run} disabled={running}>
            {running ? (
              <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5 mr-1" />
            )}
            {running ? '正在生成…' : '生成'}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-3 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{error.message}</span>
            </div>
            {error.needsConfig && (
              <Button size="sm" variant="outline" onClick={() => setSection('settings')}>
                去设置里填 API Key
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm">
                {ASSIST_MODE_LABELS[result.mode]} · {result.weekStart}
              </CardTitle>
              {result.tasks.length > 0 && (
                <div className="flex items-center gap-2">
                  {writtenCount > 0 && (
                    <span className="text-[11px] text-emerald-600 flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> 已写入 {writtenCount} 条
                    </span>
                  )}
                  <Button size="sm" variant="outline" onClick={writeToWeek} disabled={writing}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {writing ? '写入中…' : `写入本周计划（${result.tasks.length}）`}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.parseError && (
              <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                没能解析成任务清单（{result.parseError}）。下面是模型的原始回复，可据此手工添加。
              </div>
            )}

            {result.tasks.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[11px] text-muted-foreground">
                  共 {result.tasks.length} 条 · 合计 {totalHours} 小时
                  {capacity ? `（本周可用 ${capacity} 小时）` : ''}
                </div>
                {result.tasks.map((task, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-2 rounded border border-border p-2 text-xs"
                  >
                    <span className="min-w-0 truncate">
                      {index + 1}. {task.name}
                    </span>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px]">
                        {task.hours}h
                      </Badge>
                      <Badge variant="outline" className="text-[9px]">
                        P{task.priority}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/40 p-2 text-[11px] leading-relaxed">
                {result.content}
              </pre>
            )}

            {weekly?.tasks?.length ? (
              <p className="text-[10px] text-muted-foreground">
                本周计划里已有 {weekly.tasks.length} 条，写入时会追加在它们后面。
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
