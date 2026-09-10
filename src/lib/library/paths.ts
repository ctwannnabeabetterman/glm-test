import path from 'node:path'
import fs from 'node:fs'

/** 桌面版把 DATABASE_URL 指到 userData/db/custom.db；PDF 入库到同级 library/ */
export function libraryRoot(): string {
  const url = process.env.DATABASE_URL || ''
  const m = url.match(/^file:(.+)$/)
  if (m) {
    let raw = m[1]
    if (process.platform === 'win32') raw = raw.replace(/^\/+/, '')
    const dbFile = path.resolve(raw)
    return path.join(path.dirname(dbFile), '..', 'library')
  }
  return path.join(process.cwd(), 'library')
}

export function pdfStorageDir(): string {
  const dir = path.join(libraryRoot(), 'pdfs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function safePdfName(original: string): string {
  const base = path.basename(original || 'paper.pdf').replace(/[<>:"/\\|?*]/g, '_')
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`
}
