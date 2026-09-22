import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { summarizeActivity, type ActivityLike } from '@/lib/activity'

/**
 * GET /api/activity/recent?days=7 —— 「近 N 天使用记录」的按天 + 按模块聚合。
 *
 * ⚠️ **表不存在时要优雅降级**（返回空结构而不是 500）：
 * `Activity` 是 2026-09-22 新增的表，已经装在用户机器上的旧版本要等下次启动的
 * `migrateDatabase()` 才会建出来；在那之前（或用户用浏览器直接连开发服务时）
 * 这里要是抛 500，界面上就是一块红叉，用户不知道该怎么办。
 * 所以失败时返回 200 + `unavailable: true`，界面据此显示「重启客户端后自动补上」。
 */
export async function GET(request: NextRequest) {
  const raw = Number(request.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(90, Math.max(1, Math.round(raw))) : 7
  const now = new Date()
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))

  try {
    const rows = (await db.activity.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, module: true, action: true, title: true, refId: true, detail: true },
    })) as ActivityLike[]
    return NextResponse.json(summarizeActivity(rows, now, days))
  } catch (e) {
    console.warn('[activity] 聚合失败（表可能尚未创建）：', (e as Error)?.message ?? e)
    return NextResponse.json({
      days: [],
      modules: [],
      totals: { count: 0, activeDays: 0 },
      busiest: null,
      unavailable: true,
      hint: '使用记录表还没建出来 —— 重启客户端后会自动补上（旧版本升级后首次启动会执行建表）。',
    })
  }
}
