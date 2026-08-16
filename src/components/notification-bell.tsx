'use client'

import { useFetch } from '@/lib/hooks'
import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Bell, Clock, Target, Flame, Info, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'

interface Notification {
  id: string
  type: 'deadline' | 'goal' | 'streak' | 'info'
  priority: 'high' | 'medium' | 'low'
  title: string
  desc: string
  action?: string
  daysLeft?: number
}
interface NotificationData {
  notifications: Notification[]
  stats: { total: number; high: number; medium: number; low: number }
}

const TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  deadline: { icon: Clock, color: 'text-red-600 bg-red-500/10' },
  goal: { icon: Target, color: 'text-amber-600 bg-amber-500/10' },
  streak: { icon: Flame, color: 'text-orange-600 bg-orange-500/10' },
  info: { icon: Info, color: 'text-blue-600 bg-blue-500/10' },
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  high: { label: '紧急', color: 'bg-red-500 text-white' },
  medium: { label: '重要', color: 'bg-amber-500 text-white' },
  low: { label: '提示', color: 'bg-blue-500 text-white' },
}

export function NotificationBell() {
  const { data, loading } = useFetch<NotificationData>('/api/notifications')
  const [open, setOpen] = useState(false)
  const setSection = useAppStore((s) => s.setSection)

  const notifications = data?.notifications || []
  const highCount = data?.stats.high || 0

  const handleAction = (action?: string) => {
    if (!action) return
    if (action.includes('投稿')) setSection('planner')
    else if (action.includes('写作')) setSection('planner')
    else if (action.includes('阅读') || action.includes('论文')) setSection('papers')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="通知"
        >
          <Bell className="h-4 w-4" />
          {highCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
              {highCount}
            </span>
          )}
          {highCount === 0 && notifications.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="rounded-lg border border-border bg-popover shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border p-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">通知提醒</span>
            </div>
            {notifications.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {notifications.length} 条
              </Badge>
            )}
          </div>

          {/* Notifications list */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">加载中...</div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                暂无通知 · 一切就绪！
              </div>
            ) : (
              <div className="divide-y divide-border">
                {notifications.map((n) => {
                  const config = TYPE_CONFIG[n.type]
                  const priorityConfig = PRIORITY_CONFIG[n.priority]
                  const Icon = config.icon
                  return (
                    <div
                      key={n.id}
                      className="flex items-start gap-2.5 p-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => handleAction(n.action)}
                    >
                      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', config.color)}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-xs font-medium line-clamp-1">{n.title}</span>
                          <span className={cn('text-[8px] px-1 py-0.5 rounded-full shrink-0', priorityConfig.color)}>
                            {priorityConfig.label}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground line-clamp-2">{n.desc}</div>
                        {n.action && (
                          <div className="text-[10px] text-primary mt-1 hover:underline">
                            {n.action} →
                          </div>
                        )}
                      </div>
                      {n.daysLeft !== undefined && (
                        <div className={cn(
                          'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded',
                          n.daysLeft < 0 ? 'bg-red-500/15 text-red-600' : n.daysLeft <= 3 ? 'bg-amber-500/15 text-amber-600' : 'bg-muted text-muted-foreground'
                        )}>
                          {n.daysLeft < 0 ? `逾期${-n.daysLeft}天` : n.daysLeft === 0 ? '今天' : `${n.daysLeft}天`}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-border p-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>紧急: {data?.stats.high || 0} · 重要: {data?.stats.medium || 0} · 提示: {data?.stats.low || 0}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => setOpen(false)}
              >
                关闭
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
