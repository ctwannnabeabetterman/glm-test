import { NextRequest, NextResponse } from 'next/server'
import { csvEscape } from '@/lib/library/paper-notes'
import { SWEEP_METRICS, sweepToCsv, type SweepMetric, type SweepSeries } from '@/lib/sim/sweep'

/**
 * POST /api/sim/sweep/export —— 把扫描结果导成 CSV。
 *
 * 为什么走**服务端**而不是前端拼 Blob：桌面端的 Blob 下载在 Electron 里经常落不到文件
 * （科研笔记的 Markdown 导出踩过这个坑，后来改成服务端附件下载才稳）。
 * 这里的数据由前端 POST 上来即可 —— 不必重跑一遍扫描（那要几分钟）。
 *
 * 转义复用 `lib/library/paper-notes.ts` 的 `csvEscape`：引号/逗号/换行的处理只维护一份，
 * 带 BOM + CRLF 才能让 Excel 双击打开中文不乱码（与论文列表 CSV 同一套口径）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const series = Array.isArray(body.series) ? (body.series as SweepSeries[]) : []
    if (series.length === 0) {
      return NextResponse.json({ error: '没有可导出的扫描结果' }, { status: 400 })
    }
    const metric = (SWEEP_METRICS.find((m) => m.id === body.metric)?.id ?? 'deliveryRatePercent') as SweepMetric
    const xLabel = typeof body.xLabel === 'string' && body.xLabel ? body.xLabel : '参数值'
    const csv = sweepToCsv(series, metric, xLabel, csvEscape)
    const safeLabel = xLabel.replace(/[^\w\u4e00-\u9fa5]/g, '')
    const filename = `参数扫描-${safeLabel}-${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: '导出失败: ' + (e as Error).message }, { status: 400 })
  }
}
