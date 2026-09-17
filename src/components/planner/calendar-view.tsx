'use client'

/**
 * 日历视图（D5）。
 *
 * 网格在**客户端**算（`monthMatrix` 是纯函数），所以切换月份不会再打接口 ——
 * 一次拉全量事件，之后纯本地渲染。月历以周一为一周之始，与周计划口径一致。
 */

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useFetch } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { downloadFromApi } from '@/lib/download'
import { toLocalIsoDate } from '@/lib/planner/schedule'
import {
  WEEKDAY_HEADERS,
  eventsByDate,
  monthMatrix,
  type CalendarEvent,
} from '@/lib/planner/calendar'
import { CalendarDays, ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react'

interface CalendarResponse {
  generatedAt: string
  projectStart: string
  events: CalendarEvent[]
  counts: { total: number; milestones: number; tasks: number; done: number }
}

/** 事件配色：已完成绿、周任务琥珀、里程碑青 */
function eventChipClass(event: CalendarEvent): string {
  if (event.done) return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
  if (event.kind === 'task') return 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
  return 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
}

export function CalendarView() {
  const { data, refetch } = useFetch<CalendarResponse>('/api/planner/calendar')
  const [exporting, setExporting] = useState(false)
  const todayIso = useMemo(() => toLocalIsoDate(new Date()), [])
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [selected, setSelected] = useState(todayIso)

  const matrix = useMemo(() => monthMatrix(cursor.year, cursor.month), [cursor])
  const byDate = useMemo(() => eventsByDate(data?.events ?? []), [data])
  const selectedEvents = byDate.get(selected) ?? []

  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const total = c.year * 12 + (c.month - 1) + delta
      return { year: Math.floor(total / 12), month: (total % 12) + 1 }
    })
  }

  const goToday = () => {
    const now = new Date()
    setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 })
    setSelected(todayIso)
  }

  const exportIcs = async () => {
    setExporting(true)
    try {
      await downloadFromApi('/api/planner/calendar?format=ics', '研究规划日历.ics')
      toast.success('已导出 .ics，可导入手机 / 电脑日历')
    } catch {
      toast.error('导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      <Card className="bg-cyan-500/5 border-cyan-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CalendarDays className="h-3.5 w-3.5 inline mr-1 text-cyan-600" />
            <strong className="text-cyan-700 dark:text-cyan-400">日历</strong>
            {data
              ? ` —— ${data.counts.total} 个日程（里程碑 ${data.counts.milestones} · 周任务 ${data.counts.tasks} · 已完成 ${data.counts.done}）`
              : ' —— 加载中…'}
            {data ? (data.projectStart ? ` · 项目起点 ${data.projectStart}` : ' · 未设项目起始日（甘特里程碑不入日历）') : ''}
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={goToday}>
              今天
            </Button>
            <Button size="sm" variant="ghost" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> 刷新
            </Button>
            <Button size="sm" variant="outline" onClick={exportIcs} disabled={exporting}>
              <Download className="h-3.5 w-3.5 mr-1" /> 导出 .ics
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => shiftMonth(-1)} aria-label="上一个月">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="text-base">
              {cursor.year} 年 {cursor.month} 月
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={() => shiftMonth(1)} aria-label="下一个月">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription className="text-center text-[10px]">
            点某一天看当天安排 · 导出 .ics 后可在手机日历里收到「截止前 1 天」提醒
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-1">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_HEADERS.map((label) => (
              <div key={label} className="text-center text-[10px] text-muted-foreground py-1">
                周{label}
              </div>
            ))}
          </div>

          {matrix.map((row, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-7 gap-1">
              {row.map((cell) => {
                const events = byDate.get(cell.iso) ?? []
                const isToday = cell.iso === todayIso
                const isSelected = cell.iso === selected
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={() => setSelected(cell.iso)}
                    className={cn(
                      'min-h-[72px] rounded border p-1 text-left align-top transition-colors',
                      cell.inMonth ? 'bg-card' : 'bg-muted/40 opacity-60',
                      isSelected ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-accent/40',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn('text-[10px]', isToday ? 'font-bold text-primary' : 'text-muted-foreground')}>
                        {cell.iso.slice(8)}
                      </span>
                      {events.length > 2 && (
                        <span className="text-[9px] text-muted-foreground">+{events.length - 2}</span>
                      )}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {events.slice(0, 2).map((event) => (
                        <div
                          key={event.id}
                          className={cn('truncate rounded px-1 py-0.5 text-[9px]', eventChipClass(event))}
                          title={event.title}
                        >
                          {event.title}
                        </div>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {selected} 的安排（{selectedEvents.length}）
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {selectedEvents.length === 0 && (
            <div className="text-xs text-muted-foreground py-3 text-center">这一天没有安排</div>
          )}
          {selectedEvents.map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0 flex items-center gap-1.5">
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px]', eventChipClass(event))}>
                  {event.kind === 'task' ? '周任务' : '里程碑'}
                </span>
                <span className="truncate">{event.title}</span>
              </div>
              <div className="shrink-0 text-[10px] text-muted-foreground">
                {event.startDate === event.endDate ? event.startDate : `${event.startDate} ~ ${event.endDate}`}
                {event.note ? ` · ${event.note}` : ''}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
