'use client'

import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Settings2, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export type WidgetId =
  | 'hero'
  | 'quickStats'
  | 'layerArchitecture'
  | 'topTopics'
  | 'venues'
  | 'readingProgress'
  | 'scholars'
  | 'quickAccess'
  | 'statsCharts'
  | 'recommendations'
  | 'readingGoals'
  | 'readingHeatmap'
  | 'readingHistory'
  | 'achievements'
  | 'dataManagement'

const WIDGET_CONFIG: Array<{ id: WidgetId; label: string; desc: string; default: boolean }> = [
  { id: 'hero', label: '欢迎横幅', desc: '项目标题和快捷操作', default: true },
  { id: 'quickStats', label: '快速统计', desc: '论文/课题/实验/里程碑计数', default: true },
  { id: 'layerArchitecture', label: '三层架构图', desc: 'AI for Wireless 三层架构', default: true },
  { id: 'topTopics', label: '课题评估 Top', desc: '评分最高的课题', default: true },
  { id: 'venues', label: '顶会顶刊时间表', desc: 'IEEE 会议/期刊列表', default: true },
  { id: 'readingProgress', label: '阅读进度', desc: '论文阅读状态统计', default: true },
  { id: 'scholars', label: '推荐追踪学者', desc: 'AI+通信方向学者', default: true },
  { id: 'quickAccess', label: '快捷入口', desc: '6 模块全流程入口', default: true },
  { id: 'statsCharts', label: '数据统计可视化', desc: '饼图和柱状图', default: true },
  { id: 'recommendations', label: '个性化推荐', desc: '基于阅读历史的论文推荐', default: true },
  { id: 'readingGoals', label: '阅读目标追踪', desc: '每周/每月阅读目标', default: true },
  { id: 'readingHeatmap', label: '阅读活动热力图', desc: 'GitHub 风格热力图', default: true },
  { id: 'readingHistory', label: '阅读时长历史', desc: '每日阅读时长柱状图', default: true },
  { id: 'achievements', label: '成就与徽章', desc: '科研里程碑和徽章', default: true },
  { id: 'dataManagement', label: '数据管理', desc: '导出/导入备份', default: true },
]

const STORAGE_KEY = 'dashboard-widgets'

export function useWidgetVisibility() {
  const [visibleWidgets, setVisibleWidgets] = useState<Set<WidgetId>>(() => {
    if (typeof window === 'undefined') {
      return new Set(WIDGET_CONFIG.map((w) => w.id))
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return new Set(JSON.parse(stored))
      }
    } catch {}
    return new Set(WIDGET_CONFIG.map((w) => w.id))
  })

  const toggle = (id: WidgetId) => {
    setVisibleWidgets((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)))
      return next
    })
  }

  const reset = () => {
    const all = new Set(WIDGET_CONFIG.map((w) => w.id))
    setVisibleWidgets(all)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(all)))
    toast.success('已重置为默认显示')
  }

  const isVisible = (id: WidgetId) => visibleWidgets.has(id)

  return { isVisible, toggle, reset, visibleWidgets }
}

export function WidgetCustomizer() {
  const { isVisible, toggle, reset, visibleWidgets } = useWidgetVisibility()
  const [open, setOpen] = useState(false)

  const hiddenCount = WIDGET_CONFIG.length - visibleWidgets.size

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
        >
          <Settings2 className="h-3.5 w-3.5 mr-1" />
          自定义
          {hiddenCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-[9px] py-0 px-1">
              {hiddenCount} 隐藏
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="rounded-lg border border-border bg-popover shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border p-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">组件显示设置</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px]"
              onClick={reset}
            >
              <RotateCcw className="h-2.5 w-2.5 mr-1" />
              重置
            </Button>
          </div>

          {/* Widget list */}
          <div className="max-h-[400px] overflow-y-auto">
            <div className="divide-y divide-border">
              {WIDGET_CONFIG.map((w) => {
                const visible = isVisible(w.id)
                return (
                  <div
                    key={w.id}
                    className="flex items-center gap-2 p-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => toggle(w.id)}
                  >
                    <div className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      visible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    )}>
                      {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn('text-xs font-medium', !visible && 'text-muted-foreground line-through')}>
                        {w.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">{w.desc}</div>
                    </div>
                    <div className={cn(
                      'h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
                      visible ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                    )}>
                      {visible && (
                        <svg className="h-2.5 w-2.5 text-primary-foreground m-auto mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border p-2 text-[10px] text-muted-foreground text-center">
            显示 {visibleWidgets.size}/{WIDGET_CONFIG.length} 个组件
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
