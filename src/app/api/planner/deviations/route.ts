import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  computeDeviation,
  renderDeviationMarkdown,
  sortForDeviation,
  summarizeDeviation,
  type MilestoneLike,
} from '@/lib/planner/linkage'
import { loadProjectConfig } from '@/lib/planner/server'
import { toLocalIsoDate } from '@/lib/planner/schedule'

const SUPPORTED = ['json', 'md'] as const
type Format = (typeof SUPPORTED)[number]

/**
 * GET /api/planner/deviations            → 结构化偏差数据（页面用）
 * GET /api/planner/deviations?format=md  → 同一份数据的 Markdown 报告（下载用）
 *
 * 两种输出共用一个计算函数，保证「页面看到的」与「导出的」不会各算各的。
 */
export async function GET(request: NextRequest) {
  try {
    const format = (request.nextUrl.searchParams.get('format') || 'json').toLowerCase()
    // 与 /api/notes/export、/api/writing/.../export 一致：不支持的格式显式 400，不静默回退
    if (!SUPPORTED.includes(format as Format)) {
      return NextResponse.json({ error: `Unsupported format: ${format}`, supported: SUPPORTED }, { status: 400 })
    }

    const config = await loadProjectConfig()
    const now = new Date()

    const raw = await db.milestone.findMany()
    const stateFilter = request.nextUrl.searchParams.get('state')
    let rows = raw.map((m) => computeDeviation(m as unknown as MilestoneLike, config.startDate, now))
    if (stateFilter && stateFilter !== 'all') rows = rows.filter((r) => r.state === stateFilter)
    rows = sortForDeviation(rows)
    const summary = summarizeDeviation(rows)

    if (format === 'md') {
      const markdown = renderDeviationMarkdown(rows, summary, {
        projectStart: config.startDate,
        generatedAt: now,
      })
      const filename = `研究进度偏差报告-${toLocalIsoDate(now)}.md`
      return new NextResponse(markdown, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          // RFC 5987：中文文件名走 filename*，避免下载出乱码
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      })
    }

    return NextResponse.json({
      projectStart: config.startDate,
      generatedAt: now.toISOString(),
      rows,
      summary,
    })
  } catch (e) {
    console.error('GET planner deviations error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
