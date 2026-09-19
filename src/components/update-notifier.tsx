'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Download, Loader2, Rocket, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { clampPercent, describeDownloadDetail } from '@/lib/update-progress'
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
 * 等于提醒过了、但用户没记住。这里做一条常驻横幅挂在右下角，只要没处理就一直可见；
 * 有新版时再补一个 toast 保证第一眼能看到。
 *
 * ⚠️ 2026-09-18 用户实测反馈（首次走通自更新后）：「不知道怎么下的，需要重启安装，
 *    然后安装没有进度条之类的」。逐条对应到这里的改动：
 *
 *  1.「不知道怎么下的」—— 下载进度以前只显示一个百分比数字，用户无从判断
 *     「在下 / 卡住 / 下完了」，也不知道文件落在哪。现在下载中显示真正的进度条
 *     + 已下载/总量 + 速度；下载完成显示安装包的本机路径。
 *  2.「需要重启安装」—— 这是 electron-updater 的固有行为（安装必须替换正在运行
 *     的程序文件），改不掉。能做的是把「为什么」和「会花多久」提前讲清楚，
 *     所以这里把文案从「重启后生效」改成明确的动作说明。
 *  3.「安装没有进度条」—— 根因是 NSIS 的 /S 静默安装（见 desktop/main.js 的
 *     applyUpdateAndRestart 注释），**架构上给不了安装进度**。所以补偿点在
 *     退出之前：主进程会先弹一个确认框讲清「窗口会消失 10–60 秒、没有进度条是正常的」。
 *     本卡片负责在点按钮之前就把这句话说出来，别让用户点完才发现窗口没了。
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
      // 下载完成是个「需要用户动手」的节点，必须重新出现（哪怕之前点过忽略）
      if (payload.state === 'downloaded') {
        setDismissed(false)
        toast.success(payload.message || '更新已下载完成', { duration: 10000 })
      }
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

  // 下载进度派生量：百分比 + 传输量/速度/剩余时间（数据来自主进程 download-progress 事件）
  const pct = clampPercent(status.percent)
  const detail = describeDownloadDetail(status)

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
                · 当前 {status.current}，可以现在就下载，也可以退出时自动安装
              </span>
            </>
          )}
          {status.state === 'downloading' && (
            <>
              <span className="font-medium">正在下载更新 {pct}%</span>
              {detail && <span className="text-muted-foreground"> · {detail}</span>}
              {/* 真正的进度条：以前只有一个数字，用户无法判断「在下」还是「卡住」。
                  进度数据（percent）主进程一直在推，只是没有可视化。 */}
              <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                下载期间可以继续使用，不影响写作。
              </span>
            </>
          )}
          {status.state === 'downloaded' && (
            <>
              <span className="font-medium">新版本 {status.version} 已就绪</span>
              <span className="text-muted-foreground">
                {' '}
                · 点「立即重启并安装」生效（应用会自动重开）
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                安装时会静默进行、不显示进度条：窗口先关闭，约 10–60 秒后自己回来，属正常现象。
              </span>
              {status.file && (
                <span className="mt-1 block truncate text-xs text-muted-foreground" title={status.file}>
                  安装包已存于：{status.file}
                </span>
              )}
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
          <span className="tabular-nums shrink-0 font-medium text-primary">{pct}%</span>
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
