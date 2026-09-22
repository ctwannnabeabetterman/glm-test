'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Activity, Loader2, RotateCw } from 'lucide-react'
import { ACTION_LABEL, moduleColor, type ActivityAction, type ActivitySummary } from '@/lib/activity'
import { cn } from '@/lib/utils'

/**
 * 「近 7 天使用记录」—— **跨模块**的活动聚合（不只是仿真运行）。
 *
 * 用户的原话是「运行记录不止是实验室记录，还有每次操作的记录，比如我在什么时候写了科研笔记、
 * 什么时候写了摘要，每个模块的使用都有记录」—— 所以这里记录的是**整个工作台的使用节奏**：
 * 写了几篇笔记、跑了几次 AI、入库了几篇论文、改了几次稿件……都能看到。
 *
 * 三个刻意的设计：
 *  1. **空白天也画出来**：否则「这周没干活」这件事在图上会消失，而它恰恰是最该被看见的信息；
 *  2. **按模块堆叠**：一眼看出这周的时间花在哪（论文库 vs 写作 vs 仿真），而不是只看到一个总数；
 *  3. **表不可用时说人话**：`Activity` 是新表，旧版本升级后首次启动才会建出来；
 *     这种情况下要给「重启客户端后会自动补上」的提示，而不是一块红叉。
 */

interface ActivityItem {
  id: string
  at: string
  module: string
  moduleLabel: string
  color: string
  action: string
  actionLabel: string
  title: string
  refId: string
}

const MAX_STACK = 5

export function RecentActivityPanel() {
  const [data, setData] = useState<(ActivitySummary & { unavailable?: boolean; hint?: string }) | null>(null)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [moduleFilter, setModuleFilter] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/activity/recent?days=7')
      if (res.ok) setData(await res.json())
    } catch {
      // 这块是辅助信息，拉不到不该弹错打断用户
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 与实验历史同一套路：唯一 setState 在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary()
  }, [loadSummary])

  const loadItems = useCallback(async (day: string | null, module: string | null) => {
    setItemsLoading(true)
    try {
      const qs = new URLSearchParams()
      if (day) qs.set('date', day)
      else qs.set('days', '7')
      if (module) qs.set('module', module)
      qs.set('limit', '200')
      const res = await fetch('/api/activity?' + qs.toString())
      const json = (await res.json()) as { items?: ActivityItem[] }
      setItems(json.items ?? [])
    } catch {
      setItems([])
    } finally {
      setItemsLoading(false)
    }
  }, [])

  const days = data?.days ?? []
  const moduleTotals = data?.modules ?? []

  // 堆叠柱：取窗口内最多的 5 个模块，其余归到「其他」（否则图例会长到看不清）
  const stacked = useMemo(() => {
    if (days.length === 0) return { rows: [] as Record<string, string | number>[], keys: [] as string[] }
    const allModules = new Set<string>()
    for (const d of days) for (const m of d.byModule) allModules.add(m.module)
    const ranked = [...allModules].sort(
      (a, b) =>
        (moduleTotals.find((x) => x.module === b)?.count ?? 0) - (moduleTotals.find((x) => x.module === a)?.count ?? 0),
    )
    const top = ranked.slice(0, MAX_STACK)
    const keys = [...top, ...(ranked.length > top.length ? ['__other'] : [])]
    const rows = days.map((d) => {
      const row: Record<string, string | number> = { date: d.date.slice(5), full: d.date }
      let other = 0
      for (const m of d.byModule) {
        if (top.includes(m.module)) row[m.module] = m.count
        else other += m.count
      }
      if (other > 0) row.__other = other
      return row
    })
    return { rows, keys }
  }, [days, moduleTotals])

  const toggleDay = (day: string) => {
    if (selectedDay === day) {
      setSelectedDay(null)
      setItems(null)
      return
    }
    setSelectedDay(day)
    void loadItems(day, moduleFilter)
  }

  const toggleModule = (m: string) => {
    const next = moduleFilter === m ? null : m
    setModuleFilter(next)
    void loadItems(selectedDay, next)
  }

  const label = (key: string) =>
    key === '__other' ? '其他' : moduleTotals.find((m) => m.module === key)?.label ?? key

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" /> 近 7 天使用记录
          <span className="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {data && !data.unavailable
              ? `共 ${data.totals.count} 次操作 · 有 ${data.totals.activeDays} 天在干活` +
                (data.busiest ? ` · 最忙 ${data.busiest.date.slice(5)}（${data.busiest.count} 次）` : '')
              : ''}
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => {
                void loadSummary()
                if (selectedDay || moduleFilter) void loadItems(selectedDay, moduleFilter)
              }}
            >
              <RotateCw className="h-3 w-3" /> 刷新
            </button>
          </span>
        </CardTitle>
        <CardDescription className="text-xs">
          写笔记、生成摘要、入库论文、跑实验、改稿件……每个模块的操作都在这里；点柱子看当天做了什么，点右侧模块可筛选。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.unavailable && (
          <p className="rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {data.hint ?? '使用记录表还没建出来。'}（重启客户端后会自动补上，不需要手动处理）
          </p>
        )}

        {!data?.unavailable && days.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
            <div className="h-[170px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stacked.rows} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} vertical={false} />
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis fontSize={10} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(l, p) =>
                      p && p[0] ? `${String((p[0].payload as { full?: string }).full ?? l)}（点柱子看当天明细）` : String(l)
                    }
                    formatter={(value: number, name: string) => [`${value} 次`, label(String(name))]}
                  />
                  <Legend formatter={(v) => <span className="text-[10px]">{label(String(v))}</span>} />
                  {stacked.keys.map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="activity"
                      fill={key === '__other' ? '#94a3b8' : moduleColor(key)}
                      radius={[3, 3, 0, 0]}
                      cursor="pointer"
                      onClick={(d: { full?: string }) => d?.full && toggleDay(d.full)}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">这周主要花在哪</p>
              {moduleTotals.slice(0, 8).map((m) => (
                <button
                  key={m.module}
                  type="button"
                  onClick={() => toggleModule(m.module)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md border px-2 py-1 text-[11px] transition-colors',
                    moduleFilter === m.module ? 'border-primary bg-primary/10 text-primary' : 'border-transparent hover:bg-muted/50',
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
                  <span className="flex-1 text-left">{m.label}</span>
                  <span className="tabular-nums text-muted-foreground">{m.count}</span>
                </button>
              ))}
              {moduleFilter && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => toggleModule(moduleFilter)}
                >
                  清除「{moduleTotals.find((m) => m.module === moduleFilter)?.label ?? moduleFilter}」筛选
                </button>
              )}
            </div>
          </div>
        )}

        {!data?.unavailable && data?.totals.count === 0 && (
          <p className="py-3 text-center text-xs text-muted-foreground">
            最近 7 天还没有操作记录。随便做点什么（写条笔记、生成一次摘要、跑一次仿真），这里就会出现。
          </p>
        )}

        {(selectedDay || items) && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">
                {selectedDay ? selectedDay : '最近 7 天'}
                {moduleFilter ? ` · ${moduleTotals.find((m) => m.module === moduleFilter)?.label ?? moduleFilter}` : ''}
              </span>
              {itemsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span>{items?.length ?? 0} 条</span>
              <button
                type="button"
                className="ml-auto hover:text-foreground"
                onClick={() => {
                  setSelectedDay(null)
                  setItems(null)
                }}
              >
                收起
              </button>
            </div>
            <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
              {(items ?? []).map((it) => (
                <div key={it.id} className="flex items-start gap-2 rounded-md border border-border/50 px-2 py-1.5 text-[11px]">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: it.color }} />
                  <span className="w-10 shrink-0 tabular-nums text-muted-foreground">
                    {new Date(it.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span className="w-16 shrink-0 text-muted-foreground">{it.moduleLabel}</span>
                  <span className="w-14 shrink-0 text-muted-foreground">
                    {it.actionLabel || ACTION_LABEL[it.action as ActivityAction] || it.action}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={it.title}>
                    {it.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {days.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {days
              .filter((d) => d.count > 0)
              .map((d) => (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => toggleDay(d.date)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[10px] transition-colors',
                    selectedDay === d.date ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {d.date.slice(5)} · {d.count}
                  {d.byAction[0] ? <span className="ml-1 opacity-70">（{d.byAction[0].label}）</span> : null}
                </button>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
