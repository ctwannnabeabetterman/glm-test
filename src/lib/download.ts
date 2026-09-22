'use client'

/** 浏览器/Electron 通用下载：优先走桌面端「另存为」，失败再退回 a[download] */
export async function downloadBlob(blob: Blob, filename: string): Promise<boolean> {
  const electronSave = (window as Window & { electronSaveFile?: (payload: { filename: string; buffer: ArrayBuffer; mime: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> }).electronSaveFile
  if (typeof electronSave === 'function') {
    const buffer = await blob.arrayBuffer()
    const result = await electronSave({ filename, buffer, mime: blob.type || 'application/octet-stream' })
    if (result?.canceled) return false
    if (result?.ok) return true
    throw new Error(result?.error || 'Desktop save failed')
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

export async function downloadFromApi(url: string, fallbackName: string): Promise<boolean> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('导出失败')
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/)
  const filename = m ? decodeURIComponent(m[1]) : fallbackName
  return downloadBlob(blob, filename)
}

/**
 * 用 POST 拿一个附件并下载。
 *
 * 为什么需要它：有些导出**必须把数据 POST 上去**（例如参数扫描的结果只存在于前端内存里，
 * 服务端不必重跑一遍扫描）。而 `downloadFromApi` 只会发 GET。
 * 附件落盘仍走 `downloadBlob`（桌面端优先「另存为」对话框）—— 这条路径是踩过坑才稳的：
 * 前端直接 `a[download]` 在 Electron 里经常落不到文件。
 */
export async function downloadViaPost(url: string, body: unknown, fallbackName: string): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // 后端在出错时返回的是 JSON 而不是附件 —— 取出 error 文案，别让用户只看到一个「导出失败」
    let detail = ''
    try {
      const j = (await res.json()) as { error?: string }
      detail = j.error || ''
    } catch {
      detail = ''
    }
    throw new Error(detail || '导出失败')
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/)
  const filename = m ? decodeURIComponent(m[1]) : fallbackName
  return downloadBlob(blob, filename)
}
