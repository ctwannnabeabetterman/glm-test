import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import { db } from '@/lib/db'
import {
  DEFAULT_OBSIDIAN_CONFIG,
  OBSIDIAN_SETTING_KEY,
  normalizeObsidianConfig,
  type ObsidianConfig,
} from '@/lib/library/obsidian'

/** 校验 vaultPath 指向的是一个真实存在的目录 */
function inspectVault(vaultPath: string): { exists: boolean; isDir: boolean; error?: string } {
  if (!vaultPath) return { exists: false, isDir: false, error: '未配置 vault 目录' }
  try {
    const st = fs.statSync(vaultPath)
    if (!st.isDirectory()) return { exists: true, isDir: false, error: '该路径不是目录' }
    return { exists: true, isDir: true }
  } catch {
    return { exists: false, isDir: false, error: '目录不存在或无法访问' }
  }
}

async function loadCfg(): Promise<ObsidianConfig> {
  try {
    const row = await db.setting.findUnique({ where: { key: OBSIDIAN_SETTING_KEY } })
    if (!row) return { ...DEFAULT_OBSIDIAN_CONFIG }
    return normalizeObsidianConfig(row.value)
  } catch {
    return { ...DEFAULT_OBSIDIAN_CONFIG }
  }
}

// GET /api/settings/obsidian —— 读取 vault 配置并实测目录是否可用
export async function GET() {
  const cfg = await loadCfg()
  const probe = inspectVault(cfg.vaultPath)
  return NextResponse.json({
    ...cfg,
    vaultExists: probe.exists,
    vaultIsDir: probe.isDir,
    vaultError: probe.error || null,
    ready: cfg.enabled && probe.isDir,
  })
}

// PUT /api/settings/obsidian —— 保存 vault 配置
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const current = await loadCfg()
    const vaultPath =
      typeof body.vaultPath === 'string' ? body.vaultPath.trim() : current.vaultPath
    const subfolderRaw =
      typeof body.subfolder === 'string' ? body.subfolder : current.subfolder
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled

    // 复用归一化逻辑：非法子目录会兜底，杜绝 `..` 逃逸
    const next = normalizeObsidianConfig({ vaultPath, subfolder: subfolderRaw, enabled })

    await db.setting.upsert({
      where: { key: OBSIDIAN_SETTING_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: OBSIDIAN_SETTING_KEY, value: JSON.stringify(next) },
    })

    const probe = inspectVault(next.vaultPath)
    return NextResponse.json({
      success: true,
      ...next,
      vaultExists: probe.exists,
      vaultIsDir: probe.isDir,
      vaultError: probe.error || null,
      ready: next.enabled && probe.isDir,
    })
  } catch (e) {
    return NextResponse.json({ error: '保存失败: ' + (e as Error).message }, { status: 500 })
  }
}
