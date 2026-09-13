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
