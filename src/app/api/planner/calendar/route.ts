import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  buildCalendarEvents,
  icsFilename,
  renderIcs,
  type TaskLike,
} from '@/lib/planner/calendar'
import type { MilestoneLike } from '@/lib/planner/linkage'
import { loadProjectConfig } from '@/lib/planner/server'

const SUPPORTED = ['json', 'ics'] as const
type Format = (typeof SUPPORTED)[number]

/**
 * GET /api/planner/calendar            → 事件列表（月历视图用，客户端本地算网格，切月不再请求）
 * GET /api/planner/calendar?format=ics → 导出 .ics（可导入 Google / Apple / Outlook 日历）
 *
 * 两种输出共用 `buildCalendarEvents`，保证「页面上看到的」与「导出的」同源。
 * 与 notes / writing 导出、deviations 的约定一致：不支持的格式显式 400，不静默回退。
 */
export async function GET(request: NextRequest) {
  try {
    const format = (request.nextUrl.searchParams.get('format') || 'json').toLowerCase()
    if (!SUPPORTED.includes(format as Format)) {
      return NextResponse.json({ error: `Unsupported format: ${format}`, supported: SUPPORTED }, { status: 400 })
    }

    const config = await loadProjectConfig()
    const [milestoneRows, taskRows] = await Promise.all([db.milestone.findMany(), db.weeklyTask.findMany()])

    const events = buildCalendarEvents({
      milestones: milestoneRows as unknown as MilestoneLike[],
      tasks: taskRows as unknown as TaskLike[],
      projectStart: config.startDate,
    })

    const now = new Date()

    if (format === 'ics') {
      const body = renderIcs(events, {
        calendarName: 'AI Network Lab · 研究规划',
        generatedAt: now,
      })
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          // RFC 5987：中文文件名走 filename*，避免下载出乱码
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(icsFilename(now))}`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({
      generatedAt: now.toISOString(),
      projectStart: config.startDate,
      events,
      counts: {
        total: events.length,
        milestones: events.filter((e) => e.kind === 'milestone').length,
        tasks: events.filter((e) => e.kind === 'task').length,
        done: events.filter((e) => e.done).length,
      },
    })
  } catch (e) {
    console.error('GET planner calendar error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
