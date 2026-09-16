'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Download, Loader2, Rocket, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  downloadUpdate,
  installUpdate,
  onUpdateStatus,
  type UpdateStatusPayload,
} from '@/lib/desktop-update'

/**
 * 全局更新提醒。
 *
 * 为什么除了系统对话框还要有它：
 * 主进程的对话框只在「发现新版本」那一刻弹一次，用户点「稍后」之后就再没有痕迹 ——
 * 等于提醒过了、但用户没记住。这里做一条常驻横幅挂在顶部，只要没处理就一直可见；
 * 有新版时再补一个 toast 保证第一眼能看到。
 */
export function UpdateNotifier() {
  const [status, setStatus] = useState<UpdateStatusPayload | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return onUpdateStatus((payload) => {
      setStatus(payload)
      if (payload.state === 'available') {
        // 新的一轮提醒：把上次的「忽略」重置掉
        setDismissed(false)
        toast.info(payload.message || '发现新版本', { duration: 8000 })
      }
      if (payload.state === 'downloaded') setDismissed(false)
      // 多版本冲突：必须让用户第一眼看到，所以重置忽略态并补一个 toast
      if (payload.state === 'conflict') {
        setDismissed(false)
        toast.warning(payload.message || '检测到另一个版本正在运行', { duration: 10000 })
      }
    })
  }, [])

  const visible =
    !!status &&
    !dismissed &&
    (status.state === 'available' ||
      status.state === 'downloading' ||
      status.state === 'downloaded' ||
      status.state === 'conflict')

  if (!visible || !status) return null

  const onDownload = async () => {
    setBusy(true)
    const r = await downloadUpdate()
    if (!r.ok) toast.error(r.error || '下载更新失败')
    setBusy(false)
  }

  const onInstall = async () => {
    setBusy(true)
    const r = await installUpdate()
    if (!r.ok) toast.error(r.error || '安装更新失败')
    setBusy(false)
  }

  return (
    // 固定在右下角而不是顶部横幅：应用顶栏本身是 sticky top-0，两条都钉在顶部会互相压。
    // 浮动卡片不挤占布局、不遮挡导航，关掉之前一直可见。
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-end p-4">
      <div
        className={cn(
          'pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-sm shadow-lg',
          status.state === 'conflict'
            ? 'border-destructive/50 bg-destructive/10 text-foreground'
            : 'border-primary/40 bg-card text-card-foreground',
        )}
        role="status"
        aria-live="polite"
      >
        {status.state === 'conflict' ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        ) : status.state === 'downloading' ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : status.state === 'downloaded' ? (
          <Rocket className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        )}

        <span className="min-w-0 flex-1">
          {status.state === 'conflict' && (
            <>
              <span className="font-medium">检测到另一个版本的客户端正在运行</span>
              <span className="text-muted-foreground">
                {' '}
                · 请关闭它，否则两个进程会同时写同一个本地数据库
              </span>
            </>
          )}
          {status.state === 'available' && (
            <>
              <span className="font-medium">发现新版本 {status.version}</span>
              <span className="text-muted-foreground">
                {' '}
                · 当前 {status.current}，下载完成后退出时自动安装
              </span>
            </>
          )}
          {status.state === 'downloading' && (
            <>
              <span className="font-medium">正在下载更新 {status.percent ?? 0}%</span>
              <span className="text-muted-foreground"> · 可以继续使用，不影响写作</span>
            </>
          )}
          {status.state === 'downloaded' && (
            <>
              <span className="font-medium">新版本 {status.version} 已就绪</span>
              <span className="text-muted-foreground"> · 重启后生效</span>
            </>
          )}
        </span>

        {status.state === 'available' && (
          <Button size="sm" onClick={() => void onDownload()} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            下载更新
          </Button>
        )}
        {status.state === 'downloaded' && (
          <Button size="sm" onClick={() => void onInstall()} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
            立即重启并安装
          </Button>
        )}
        {status.state === 'downloading' && (
          <span className="tabular-nums text-muted-foreground">{status.percent ?? 0}%</span>
        )}

        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() => setDismissed(true)}
          title="本次不再提示"
          aria-label="本次不再提示"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
