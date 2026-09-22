import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ACTION_LABEL, moduleColor, moduleLabel, type ActivityAction } from '@/lib/activity'

/**
 * GET /api/activity?date=YYYY-MM-DD&module=xxx&limit=200
 * 使用记录的时间线（明细列表）。`date` 为空时返回最近 `days` 天。
 *
 * 与 recent 那条一样：表不存在时不要 500，而是给空列表 + 提示。
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const date = sp.get('date')
  // ⚠️ 不要叫 module：Next 的 lint 规则禁止遮蔽 Node 的 `module` 全局（no-assign-module-variable）
  const moduleFilter = sp.get('module')
  const limitRaw = Number(sp.get('limit'))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.round(limitRaw)) : 200

  const where: Record<string, unknown> = {}
  if (moduleFilter) where.module = moduleFilter
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number)
    where.createdAt = {
      gte: new Date(y, m - 1, d, 0, 0, 0, 0),
      lt: new Date(y, m - 1, d + 1, 0, 0, 0, 0),
    }
  } else {
    const daysRaw = Number(sp.get('days'))
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(90, Math.round(daysRaw)) : 7
    const now = new Date()
    where.createdAt = { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)) }
  }

  try {
    const rows = await db.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, createdAt: true, module: true, action: true, title: true, refId: true, detail: true },
    })
    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        at: r.createdAt,
        module: r.module,
        moduleLabel: moduleLabel(r.module),
        color: moduleColor(r.module),
        action: r.action,
        actionLabel: ACTION_LABEL[r.action as ActivityAction] ?? r.action,
        title: r.title,
        refId: r.refId,
        detail: r.detail,
      })),
    })
  } catch (e) {
    console.warn('[activity] 明细查询失败（表可能尚未创建）：', (e as Error)?.message ?? e)
    return NextResponse.json({ items: [], unavailable: true })
  }
}
