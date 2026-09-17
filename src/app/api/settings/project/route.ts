import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  DEFAULT_PROJECT_CONFIG,
  PROJECT_SETTING_KEY,
  normalizeProjectConfig,
  totalWeeklyHours,
  type ProjectConfig,
} from '@/lib/planner/config'

async function loadConfig(): Promise<ProjectConfig> {
  try {
    const row = await db.setting.findUnique({ where: { key: PROJECT_SETTING_KEY } })
    if (!row) return { ...DEFAULT_PROJECT_CONFIG }
    return normalizeProjectConfig(JSON.parse(row.value))
  } catch {
    // 库不存在 / JSON 坏了都不该让整个规划模块打不开，退回默认值
    return { ...DEFAULT_PROJECT_CONFIG }
  }
}

// GET /api/settings/project —— 读取项目起始日与每日可用工时
export async function GET() {
  const config = await loadConfig()
  return NextResponse.json({ ...config, weeklyHours: totalWeeklyHours(config) })
}

// PUT /api/settings/project —— 保存；未传的字段沿用现值（局部更新）
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const current = await loadConfig()
    const next = normalizeProjectConfig({
      startDate: body?.startDate === undefined ? current.startDate : body.startDate,
      dailyHours: body?.dailyHours === undefined ? current.dailyHours : body.dailyHours,
    })

    await db.setting.upsert({
      where: { key: PROJECT_SETTING_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: PROJECT_SETTING_KEY, value: JSON.stringify(next) },
    })

    return NextResponse.json({ success: true, ...next, weeklyHours: totalWeeklyHours(next) })
  } catch (e) {
    console.error('PUT project config error', e)
    return NextResponse.json({ error: '保存失败' }, { status: 500 })
  }
}
