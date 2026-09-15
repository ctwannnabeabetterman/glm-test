import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { buildResearchNoteMarkdown } from '@/lib/library/research-note'
import {
  DEFAULT_OBSIDIAN_CONFIG,
  OBSIDIAN_SETTING_KEY,
  dedupeFileNames,
  isSafeNoteFileName,
  normalizeObsidianConfig,
  obsidianFileName,
  resolveInsideVault,
  type ObsidianConfig,
} from '@/lib/library/obsidian'

interface WrittenFile {
  filename: string
  path: string
  bytes: number
}

async function loadCfg(): Promise<ObsidianConfig> {
  const row = await db.setting.findUnique({ where: { key: OBSIDIAN_SETTING_KEY } })
  if (!row) return { ...DEFAULT_OBSIDIAN_CONFIG }
  return normalizeObsidianConfig(row.value)
}

// POST /api/notes/export/obsidian —— 把科研笔记直接写入 Obsidian vault，交由 Obsidian 管理
// body: { scope: 'note' | 'category', id?: string, category?: string }
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      scope?: string
      id?: string
      category?: string
    }
    const scope = body.scope === 'note' ? 'note' : 'category'

    const cfg = await loadCfg()
    if (!cfg.vaultPath) {
      return NextResponse.json({ error: '尚未配置 Obsidian vault 目录', code: 'VAULT_NOT_SET' }, { status: 400 })
    }
    try {
      if (!fs.statSync(cfg.vaultPath).isDirectory()) {
        return NextResponse.json({ error: 'vault 路径不是目录', code: 'VAULT_NOT_DIR' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'vault 目录不存在或无法访问', code: 'VAULT_MISSING' }, { status: 400 })
    }

    // 目标目录 = vault + 子目录（子目录已在配置归一化阶段净化过）
    const dirRel = cfg.subfolder || ''
    const targetDir = dirRel ? resolveInsideVault(cfg.vaultPath, dirRel) : path.resolve(cfg.vaultPath)
    if (!targetDir) {
      return NextResponse.json({ error: '子目录非法（不允许绝对路径或 .. 逃逸）', code: 'BAD_SUBFOLDER' }, { status: 400 })
    }

    // 取出要导出的笔记
    let notes: Array<{ id: string; title: string; content: string; tags: string; category: string; structured: string; updatedAt: Date; lastReadAt: Date | null }>
    if (scope === 'note') {
      if (!body.id) return NextResponse.json({ error: '缺少笔记 id' }, { status: 400 })
      const one = await db.note.findUnique({ where: { id: body.id } })
      if (!one) return NextResponse.json({ error: '笔记不存在' }, { status: 404 })
      notes = [one]
    } else {
      const category = typeof body.category === 'string' && body.category ? body.category : 'literature'
      notes = await db.note.findMany({ where: { category }, orderBy: [{ updatedAt: 'desc' }] })
    }

    if (notes.length === 0) {
      return NextResponse.json({ ok: true, dir: targetDir, written: [], total: 0, skipped: 0 })
    }

    // 生成文件名并去重（同名笔记追加短 id，避免互相覆盖）
    const filenames = dedupeFileNames(
      notes.map((n) => ({ id: n.id, filename: obsidianFileName(n.title || '') })),
    )

    fs.mkdirSync(targetDir, { recursive: true })

    const written: WrittenFile[] = []
    const errors: Array<{ filename: string; error: string }> = []
    notes.forEach((note, i) => {
      const filename = filenames[i]
      try {
        if (!isSafeNoteFileName(filename)) {
          errors.push({ filename, error: '文件名非法' })
          return
        }
        const target = path.join(targetDir, filename)
        const content = buildResearchNoteMarkdown(note)
        fs.writeFileSync(target, content, 'utf8')
        written.push({ filename, path: target, bytes: Buffer.byteLength(content, 'utf8') })
      } catch (e) {
        errors.push({ filename, error: (e as Error).message })
      }
    })

    return NextResponse.json({
      ok: errors.length === 0,
      dir: targetDir,
      total: notes.length,
      writtenCount: written.length,
      skipped: errors.length,
      written,
      errors,
    })
  } catch (e) {
    console.error('export to obsidian error', e)
    return NextResponse.json({ error: '写入 vault 失败: ' + (e as Error).message }, { status: 500 })
  }
}
