'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Play, Pause, Square, Clock, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ReadingTimerProps {
  paperId: string
  initialTime?: number
}

type Segment = { id: string; paperId: string; duration: number }
const segmentKey = (id: string) => `reading-segment-${id}`

export function ReadingTimer({ paperId, initialTime = 0 }: ReadingTimerProps) {
  // Switching papers remounts the timer after its previous cleanup flushes that paper.
  return <PaperTimer key={paperId} paperId={paperId} initialTime={initialTime} />
}

function PaperTimer({ paperId, initialTime }: { paperId: string; initialTime: number }) {
  const [isRunning, setIsRunning] = useState(false)
  const [elapsed, setElapsed] = useState(initialTime)
  const [sessionTime, setSessionTime] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const unsavedRef = useRef(0)
  const queueRef = useRef<Segment[]>([])
  const sendingRef = useRef(false)

  // Persist the identity *before* sending; a failed/aborted request is retried with the
  // same id, never counted twice. Only the server's atomic session+increment changes totals.
  const sendQueued = useCallback(async () => {
    if (sendingRef.current) return
    sendingRef.current = true
    try {
      while (queueRef.current.length) {
        const segment = queueRef.current[0]
        try {
          const response = await fetch('/api/reading-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(segment),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const saved = await response.json() as { totalSeconds: number | null }
          queueRef.current.shift()
          try { localStorage.removeItem(segmentKey(segment.id)) } catch { /* storage unavailable */ }
          const total = saved.totalSeconds
          if (segment.paperId === paperId && typeof total === 'number') {
            const pending = queueRef.current.filter((item) => item.paperId === segment.paperId)
              .reduce((sum, item) => sum + item.duration, 0)
            setElapsed(total + unsavedRef.current + pending)
          }
        } catch (error) {
          console.error('Failed to save reading segment', error)
          toast.error('阅读时长未同步，将在下次打开或操作计时器时重试')
          break
        }
      }
    } finally {
      sendingRef.current = false
    }
  }, [paperId])

  const flush = useCallback(() => {
    if (unsavedRef.current > 0) {
      const segment: Segment = { id: crypto.randomUUID(), paperId, duration: unsavedRef.current }
      unsavedRef.current = 0
      try { localStorage.setItem(segmentKey(segment.id), JSON.stringify(segment)) } catch { /* storage unavailable */ }
      queueRef.current.push(segment)
    }
    void sendQueued()
  }, [paperId, sendQueued])

  // Restore unacknowledged segments after a tab close, including a request that succeeded
  // but whose acknowledgement never reached this tab. Do not trust old absolute localStorage time.
  useEffect(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith('reading-segment-')) continue
        const segment = JSON.parse(localStorage.getItem(key) || 'null') as Segment | null
        if (segment?.paperId === paperId && segmentKey(segment.id) === key &&
            Number.isSafeInteger(segment.duration) && segment.duration > 0 &&
            !queueRef.current.some((item) => item.id === segment.id)) {
          queueRef.current.push(segment)
        }
      }
    } catch { /* storage unavailable */ }
    void sendQueued()
    const onLeave = () => flush() // fetch only; no sendBeacon or unauthenticated endpoint
    document.addEventListener('visibilitychange', onLeave)
    window.addEventListener('pagehide', onLeave)
    return () => {
      document.removeEventListener('visibilitychange', onLeave)
      window.removeEventListener('pagehide', onLeave)
      flush()
    }
  }, [paperId, flush, sendQueued])

  // Parent details may be stale when this timer remounts; read the server's cumulative
  // value rather than resurrecting the former localStorage absolute value.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const response = await fetch(`/api/papers/${encodeURIComponent(paperId)}`)
        if (!response.ok) return
        const paper = await response.json() as { readingTime: number }
        if (active && Number.isSafeInteger(paper.readingTime)) {
          setElapsed((current) => Math.max(current, paper.readingTime))
        }
      } catch { /* next successful segment also refreshes the cumulative total */ }
    })()
    return () => { active = false }
  }, [paperId])

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        unsavedRef.current += 1
        setSessionTime((s) => s + 1)
        setElapsed((e) => e + 1)
        if (unsavedRef.current >= 30) flush()
      }, 1000)
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }
  }, [isRunning, flush])

  const handleStart = () => {
    void sendQueued()
    setIsRunning(true)
  }

  const handlePause = () => {
    setIsRunning(false)
    flush()
  }

  const handleStop = () => {
    setIsRunning(false)
    flush()
    if (sessionTime > 0) toast.success(`本次阅读 ${formatTime(sessionTime)}，累计 ${formatTime(elapsed)}`)
    setSessionTime(0)
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
