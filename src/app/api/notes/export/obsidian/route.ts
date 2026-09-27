import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { buildResearchNoteMarkdown } from '@/lib/library/research-note'
import {
  DEFAULT_OBSIDIAN_CONFIG,
  OBSIDIAN_SETTING_KEY,
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

// 标记绑定 note id，并记录上次导出的内容摘要；用户在 vault 里编辑过就不覆盖。
function exportedContent(note: { id: string; title: string; content: string; tags: string; category: string; structured: string; updatedAt: Date; lastReadAt: Date | null }) {
  const markdown = buildResearchNoteMarkdown(note)
  const hash = createHash('sha256').update(markdown).digest('hex')
  return `${markdown}<!-- ai-network-lab:note:${note.id}:${hash} -->\n`
}

function fileState(target: string, id: string): 'absent' | 'owned' | 'modified' | 'conflict' {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
    throw e
  }
  if (!stat.isFile()) return 'conflict'
  const text = fs.readFileSync(target, 'utf8')
  const marker = /<!-- ai-network-lab:note:([^\r\n<>]*):([a-f0-9]{64}) -->\r?\n?/.exec(text)
  if (!marker || marker[1] !== id) return 'conflict'
  const actual = createHash('sha256').update(text.slice(0, marker.index)).digest('hex')
  return actual === marker[2] && marker.index + marker[0].length === text.length ? 'owned' : 'modified'
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

    // 保留原有的标题文件名；当它已有别人的导出时使用稳定 id 后缀。
    // 不能仅按本次请求去重，否则「单篇 A、单篇 B」会互相覆盖。
    const names = notes.map((n) => obsidianFileName(n.title || ''))
    const duplicates = new Map<string, number>()
    for (const name of names) duplicates.set(name.toLowerCase(), (duplicates.get(name.toLowerCase()) ?? 0) + 1)

    // 在创建子目录前检查已有的每段路径，避免经符号链接在 vault 外建目录。
    const realVault = fs.realpathSync(cfg.vaultPath)
    let segment = path.resolve(cfg.vaultPath)
    for (const part of dirRel.split('/').filter(Boolean)) {
      segment = path.join(segment, part)
      if (!fs.existsSync(segment)) continue
      const real = fs.realpathSync(segment)
      if (real !== realVault && !real.startsWith(realVault + path.sep)) {
        return NextResponse.json({ error: '子目录指向 vault 外部', code: 'BAD_SUBFOLDER' }, { status: 400 })
      }
    }
    fs.mkdirSync(targetDir, { recursive: true })
    const realTarget = fs.realpathSync(targetDir)
    if (realTarget !== realVault && !realTarget.startsWith(realVault + path.sep)) {
      return NextResponse.json({ error: '子目录指向 vault 外部', code: 'BAD_SUBFOLDER' }, { status: 400 })
    }

    const written: WrittenFile[] = []
    const errors: Array<{ filename: string; error: string }> = []
    for (const [i, note] of notes.entries()) {
      const primary = names[i]
      const stem = primary.slice(0, -3)
      const alternate = `${stem}-${createHash('sha256').update(note.id).digest('hex').slice(0, 16)}.md`
      // 同批重名统一使用稳定 id 摘要；单篇仍优先沿用标题文件名。
      const preferred = duplicates.get(primary.toLowerCase())! > 1 ? alternate : primary
      const candidates = [preferred, primary, alternate].filter((name, index, all) => all.indexOf(name) === index)
      let filename = preferred
      try {
        if (!candidates.every(isSafeNoteFileName)) throw new Error('文件名非法')
        const states = candidates.map((name) => fileState(path.join(targetDir, name), note.id))
        const modifiedIndex = states.indexOf('modified')
        if (modifiedIndex !== -1) {
          filename = candidates[modifiedIndex]
          throw new Error('已在 vault 中手工修改，跳过覆盖')
        }
        const ownedIndex = states.indexOf('owned')
        if (ownedIndex !== -1) filename = candidates[ownedIndex]
        else if (states[0] === 'absent') filename = candidates[0]
        else if (states[states.length - 1] === 'absent') filename = alternate
        else throw new Error('目标文件已存在且不属于该笔记，跳过覆盖')

        const target = path.join(targetDir, filename)
        const content = exportedContent(note)
        if (fileState(target, note.id) === 'absent') {
          // 排他创建：并发或用户刚新建了文件时不可覆盖。
          fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' })
        } else if (fileState(target, note.id) === 'owned') {
          fs.writeFileSync(target, content, 'utf8')
        } else throw new Error('目标文件已被修改，跳过覆盖')
        written.push({ filename, path: target, bytes: Buffer.byteLength(content, 'utf8') })
      } catch (e) {
        errors.push({ filename, error: (e as Error).message })
      }
    }

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
