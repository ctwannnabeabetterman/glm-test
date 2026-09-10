import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchZoteroItems } from '@/lib/library/zotero'
import { mergeBibliography } from '@/lib/library/merge'
import { maskKey } from '@/lib/llm'

const SETTING_KEY = 'zotero.config'

interface ZoteroSaved {
  userId?: string
  apiKey?: string
  collectionKey?: string
}

async function loadCfg(): Promise<ZoteroSaved> {
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } })
  if (!row) return {}
  try {
    return JSON.parse(row.value) as ZoteroSaved
  } catch {
    return {}
  }
}

// GET /api/zotero/sync —— 读取已保存配置（Key 脱敏）
export async function GET() {
  const cfg = await loadCfg()
  return NextResponse.json({
    userId: cfg.userId || '',
    collectionKey: cfg.collectionKey || '',
    hasKey: Boolean(cfg.apiKey),
    keyHint: maskKey(cfg.apiKey || ''),
  })
}

// PUT /api/zotero/sync —— 保存 User ID / API Key / 可选 collection
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const current = await loadCfg()
    const next: ZoteroSaved = {
      userId: typeof body.userId === 'string' ? body.userId.trim() : current.userId,
      collectionKey: typeof body.collectionKey === 'string' ? body.collectionKey.trim() : current.collectionKey,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : current.apiKey,
    }
    if (body.clearApiKey === true) next.apiKey = ''
    await db.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: SETTING_KEY, value: JSON.stringify(next) },
    })
    return NextResponse.json({
      success: true,
      userId: next.userId || '',
      collectionKey: next.collectionKey || '',
      hasKey: Boolean(next.apiKey),
      keyHint: maskKey(next.apiKey || ''),
    })
  } catch (e) {
    return NextResponse.json({ error: '保存失败: ' + (e as Error).message }, { status: 500 })
  }
}

// POST /api/zotero/sync —— 从 Zotero 拉元数据并合并进论文库（不调 LLM）
export async function POST() {
  try {
    const cfg = await loadCfg()
    if (!cfg.userId || !cfg.apiKey) {
      return NextResponse.json({ error: '请先在设置页保存 Zotero User ID 与 API Key' }, { status: 400 })
    }
    const fetched = await fetchZoteroItems({
      userId: cfg.userId,
      apiKey: cfg.apiKey,
      collectionKey: cfg.collectionKey,
    })
    const stats = await mergeBibliography(fetched.items)
    return NextResponse.json({
      success: true,
      fetched: fetched.fetched,
      truncated: fetched.truncated,
      ...stats,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
