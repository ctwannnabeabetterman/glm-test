import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { pdfStorageDir } from '@/lib/library/paths'

const TABLES = [
  ['topics', 'topic'],
  ['papers', 'paper'],
  ['keywords', 'keyword'],
  ['experiments', 'experiment'],
  ['milestones', 'milestone'],
  ['weeklyTasks', 'weeklyTask'],
  ['notes', 'note'],
  ['searchLogs', 'searchLog'],
  ['readingGoals', 'readingGoal'],
  ['readingSessions', 'readingSession'],
  ['citations', 'citation'],
  ['manuscripts', 'manuscript'],
  ['simRuns', 'simRun'],
  ['activities', 'activity'],
  ['settings', 'setting'],
] as const

type TableName = (typeof TABLES)[number][0]
type ModelName = (typeof TABLES)[number][1]
type RecordRow = Record<string, unknown>
type BackupData = Record<TableName, RecordRow[]>
type PdfAttachment = { path: string; size: number; sha256: string; base64: string }

const LEGACY_TABLES: readonly TableName[] = ['papers', 'topics', 'experiments', 'milestones', 'notes', 'searchLogs', 'keywords']
const PORTABLE_SETTINGS = new Set(['project.config', 'papers.ai-scored'])
const MAX_PDF_BYTES = 100 * 1024 * 1024
const MAX_TOTAL_PDF_BYTES = 512 * 1024 * 1024

function modelOf(tx: Prisma.TransactionClient, name: ModelName) {
  return tx[name] as unknown as {
    findMany(args?: object): Promise<RecordRow[]>
    deleteMany(args: object): Promise<unknown>
    create(args: { data: RecordRow }): Promise<unknown>
    upsert(args: { where: RecordRow; update: RecordRow; create: RecordRow }): Promise<unknown>
  }
}

function pdfName(relativePath: string): string | null {
  if (!relativePath.startsWith('pdfs/') || relativePath !== `pdfs/${path.basename(relativePath)}`) return null
  const name = relativePath.slice(5)
  return name && name !== '.' && name !== '..' && !name.includes('\\') ? name : null
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseBackup(body: unknown): { version: 1 | 2; data: BackupData; attachments: PdfAttachment[]; mode: 'merge' | 'replace' } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('无效的备份格式')
  const input = body as Record<string, unknown>
  const version = input.version
  const mode = input.mode ?? 'merge'
  if (version !== 1 && version !== 2) throw new Error('不支持的备份版本')
  if (mode !== 'merge' && mode !== 'replace') throw new Error('无效的导入模式')
  if (version === 1 && mode === 'replace') throw new Error('旧版备份缺少稿件、仿真等数据，不允许替换；请使用合并导入')
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new Error('备份缺少数据')
  const source = input.data as Record<string, unknown>
  const keys = version === 2 ? TABLES.map(([key]) => key) : LEGACY_TABLES
  const data = {} as BackupData
  for (const key of keys) {
    if (!Array.isArray(source[key])) throw new Error(`备份缺少 ${key} 数据表`)
    const rows = source[key] as unknown[]
    if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) ||
      typeof (row as RecordRow)[key === 'settings' ? 'key' : 'id'] !== 'string' ||
      !(row as RecordRow)[key === 'settings' ? 'key' : 'id'])) {
      throw new Error(`备份 ${key} 含无效记录`)
    }
    data[key] = rows as RecordRow[]
  }
  if (version === 1) {
    for (const [key] of TABLES) if (!(key in data)) data[key] = []
  }
  if (version === 2 && (data.settings as RecordRow[]).some((row) => !PORTABLE_SETTINGS.has(row.key as string))) {
    throw new Error('备份包含敏感设置，已拒绝导入')
  }
  const attachments = version === 2 ? input.attachments : []
  if (!Array.isArray(attachments)) throw new Error('备份缺少 PDF 附件清单')
  return { version, data, attachments: attachments as PdfAttachment[], mode }
}

function decodeAttachments(data: BackupData, attachments: PdfAttachment[]): Map<string, Buffer> {
  const referenced = new Set(data.papers.map((row) => row.pdfPath).filter((p): p is string => typeof p === 'string' && p !== ''))
  const decoded = new Map<string, Buffer>()
  let total = 0
  for (const attachment of attachments) {
    if (!attachment || typeof attachment.path !== 'string' || !pdfName(attachment.path) ||
      !referenced.has(attachment.path) || decoded.has(attachment.path) ||
      !Number.isSafeInteger(attachment.size) || attachment.size < 0 || attachment.size > MAX_PDF_BYTES ||
      typeof attachment.base64 !== 'string' || attachment.base64.length > Math.ceil(attachment.size / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.base64) ||
      typeof attachment.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(attachment.sha256)) {
      throw new Error('PDF 附件清单无效')
    }
    total += attachment.size
    if (total > MAX_TOTAL_PDF_BYTES) throw new Error('PDF 附件总大小超过 512 MB')
    const bytes = Buffer.from(attachment.base64, 'base64')
    if (bytes.length !== attachment.size || sha256(bytes) !== attachment.sha256) throw new Error('PDF 附件校验失败')
    decoded.set(attachment.path, bytes)
  }
  if ([...referenced].some((p) => !decoded.has(p))) throw new Error('备份中的论文缺少 PDF 附件')
  return decoded
}

export async function GET() {
  try {
    const data = await db.$transaction(async (tx) => {
      const snapshot = {} as BackupData
      for (const [key, model] of TABLES) {
        snapshot[key] = await modelOf(tx, model).findMany(key === 'settings'
          ? { where: { key: { in: [...PORTABLE_SETTINGS] } } }
          : {})
      }
      return snapshot
    }, { timeout: 120_000 })

    const attachments: PdfAttachment[] = []
    const seen = new Set<string>()
    for (const paper of data.papers) {
      const relativePath = paper.pdfPath
      if (typeof relativePath !== 'string' || !relativePath) continue
      const name = pdfName(relativePath)
      if (!name) throw new Error('论文包含不安全的 PDF 路径')
      if (seen.has(relativePath)) continue
      const bytes = fs.readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ pdfStorageDir(), name))
      if (bytes.length > MAX_PDF_BYTES) throw new Error('单个 PDF 超过 100 MB')
      attachments.push({ path: relativePath, size: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') })
      seen.add(relativePath)
    }
    if (attachments.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_PDF_BYTES) throw new Error('PDF 附件总大小超过 512 MB')
    return NextResponse.json({
      version: 2,
      exportedAt: new Date().toISOString(),
      meta: Object.fromEntries(TABLES.map(([key]) => [key, data[key].length])),
      data,
      attachments,
    })
  } catch (error) {
    console.error('Export error', error)
    return NextResponse.json({ error: '备份导出失败：请检查 PDF 文件是否存在且未超出大小限制' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let input: ReturnType<typeof parseBackup>
  let files: Map<string, Buffer>
  try {
    input = parseBackup(await request.json())
    files = input.version === 2 ? decodeAttachments(input.data, input.attachments) : new Map()
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }

  const createdFiles: string[] = []
  try {
    const pathMap = new Map<string, string>()
    if (files.size) {
      const dir = pdfStorageDir()
      const existing = await db.paper.findMany({ select: { id: true, pdfPath: true } })
      const existingById = new Map<string, string>(existing.map((paper) => [paper.id, paper.pdfPath]))
      for (const [oldPath, bytes] of files) {
        const paper = input.data.papers.find((row) => row.pdfPath === oldPath)
        const current = paper && existingById.get(paper.id as string)
        const currentName = current && pdfName(current)
        if (currentName) {
          const currentFile = path.join(dir, currentName)
          try {
            if (fs.lstatSync(currentFile).isFile() && sha256(fs.readFileSync(/*turbopackIgnore: true*/ currentFile)) === sha256(bytes)) {
              pathMap.set(oldPath, current)
              continue
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
        const name = `backup-${randomUUID()}-${pdfName(oldPath)}`
        const dest = path.join(dir, name)
        fs.writeFileSync(dest, bytes, { flag: 'wx' })
        createdFiles.push(dest)
        pathMap.set(oldPath, `pdfs/${name}`)
      }
    }

    const results: Record<string, number> = {}
    await db.$transaction(async (tx) => {
      if (input.mode === 'replace') {
        for (const [key, model] of [...TABLES].reverse()) {
          if (key === 'settings') {
            await modelOf(tx, model).deleteMany({ where: { key: { in: [...PORTABLE_SETTINGS] } } })
          } else {
            await modelOf(tx, model).deleteMany({})
          }
        }
      }
      for (const [key, model] of TABLES) {
        const records = input.data[key]
        if (input.version === 1 && !LEGACY_TABLES.includes(key)) continue
        for (const record of records) {
          const row = { ...record }
          if (key === 'papers') {
            if (input.version === 1) {
              delete row.pdfPath
            } else if (typeof row.pdfPath === 'string' && row.pdfPath) {
              row.pdfPath = pathMap.get(row.pdfPath)
            }
          }
          const delegate = modelOf(tx, model)
          const idKey = key === 'settings' ? 'key' : 'id'
          if (input.mode === 'replace') {
            await delegate.create({ data: row })
          } else {
            const update = { ...row }
            delete update[idKey]
            await delegate.upsert({ where: { [idKey]: row[idKey] }, create: row, update })
          }
        }
        results[key] = records.length
      }
    }, { maxWait: 10_000, timeout: 120_000 })
    return NextResponse.json({ success: true, results, mode: input.mode })
  } catch (error) {
    for (const file of createdFiles) {
      try { fs.unlinkSync(file) } catch { /* 留待人工核对未完成的恢复文件 */ }
    }
    console.error('Import error', error)
    return NextResponse.json({ error: '导入失败，数据库改动已回滚；请检查备份内容及磁盘空间' }, { status: 500 })
  }
}
