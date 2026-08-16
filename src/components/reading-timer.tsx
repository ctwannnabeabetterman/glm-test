'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Play, Pause, Square, Clock, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ReadingTimerProps {
  paperId: string
  initialTime?: number // seconds
  onTimeUpdate?: (totalSeconds: number) => Promise<void>
}

export function ReadingTimer({ paperId, initialTime = 0, onTimeUpdate }: ReadingTimerProps) {
  const [isRunning, setIsRunning] = useState(false)
  // Initialize from localStorage if available, otherwise use initialTime
  const [elapsed, setElapsed] = useState(() => {
    if (typeof window === 'undefined') return initialTime
    const saved = localStorage.getItem(`reading-time-${paperId}`)
    if (saved) {
      const parsed = parseInt(saved, 10)
      if (!isNaN(parsed) && parsed > initialTime) return parsed
    }
    return initialTime
  })
  const [sessionTime, setSessionTime] = useState(0) // current session seconds
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const lastSaveRef = useRef<number>(0)

  // Save on unmount or stop
  const saveTime = useCallback(async (totalSeconds: number) => {
    localStorage.setItem(`reading-time-${paperId}`, String(totalSeconds))
    if (onTimeUpdate) {
      try {
        await onTimeUpdate(totalSeconds)
      } catch (e) {
        console.error('Failed to save reading time', e)
      }
    }
  }, [paperId, onTimeUpdate])

  // Timer tick
  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setSessionTime((s) => s + 1)
        setElapsed((e) => e + 1)
      }, 1000)
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }
  }, [isRunning])

  // Auto-save every 30 seconds while running
  useEffect(() => {
    if (isRunning && sessionTime > 0 && sessionTime - lastSaveRef.current >= 30) {
      lastSaveRef.current = sessionTime
      saveTime(elapsed)
    }
  }, [sessionTime, isRunning, elapsed, saveTime])

  const handleStart = () => {
    setIsRunning(true)
    lastSaveRef.current = sessionTime
  }

  const handlePause = async () => {
    setIsRunning(false)
    await saveTime(elapsed)
  }

  const handleStop = async () => {
    setIsRunning(false)
    if (sessionTime > 0) {
      toast.success(`本次阅读 ${formatTime(sessionTime)}，累计 ${formatTime(elapsed)}`)
      // Record session to API
      try {
        await fetch('/api/reading-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paperId, duration: sessionTime }),
        })
      } catch {
        // Silent fail - session tracking is non-critical
      }
    }
    setSessionTime(0)
    lastSaveRef.current = 0
    await saveTime(elapsed)
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  return (
    <div className={cn(
      'rounded-lg border p-3 transition-all',
      isRunning ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card'
    )}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            isRunning ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
          )}>
            <Timer className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-medium flex items-center gap-1.5">
              阅读计时器
              {isRunning && (
                <span className="flex items-center gap-1 text-[10px] text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  进行中
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">方法论 §2.3 三遍阅读法 · 追踪阅读时长</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Time display */}
          <div className="text-right">
            <div className={cn(
              'text-lg font-bold font-mono tabular-nums',
              isRunning ? 'text-primary' : 'text-foreground'
            )}>
              {formatTime(elapsed)}
            </div>
            {sessionTime > 0 && (
              <div className="text-[9px] text-muted-foreground">
                本次: {formatTime(sessionTime)}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-1">
            {!isRunning ? (
              <Button
                size="sm"
                variant="default"
                className="h-8 px-2.5"
                onClick={handleStart}
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5"
                onClick={handlePause}
              >
                <Pause className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2.5 text-destructive hover:text-destructive"
              onClick={handleStop}
              disabled={!isRunning && sessionTime === 0}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Session stats */}
      {elapsed > 0 && (
        <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            累计 {formatTime(elapsed)}
          </span>
          {elapsed >= 3600 && (
            <Badge variant="secondary" className="text-[9px] bg-amber-500/15 text-amber-600">
              深度阅读 {Math.floor(elapsed / 3600)}h+
            </Badge>
          )}
          {elapsed >= 1800 && elapsed < 3600 && (
            <Badge variant="secondary" className="text-[9px] bg-blue-500/15 text-blue-600">
              认真阅读 30min+
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
