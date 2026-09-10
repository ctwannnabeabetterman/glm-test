import fs from 'node:fs'
import path from 'node:path'

export interface MetricSeries { name: string; unit: string; samples: { time: number; value: number }[] }
export interface ResultSummary { metrics: Record<string, number>; series: MetricSeries[]; sourceFiles: string[] }

const METRIC_ALIASES: Record<string, string> = {
  pdr: 'deliveryRatePercent', deliveryRate: 'deliveryRatePercent', throughput: 'throughputMbps',
  latency: 'latencyMeanMs', latencyMean: 'latencyMeanMs', latencyP95: 'latencyP95Ms',
  jitter: 'jitterMs', sinr: 'sinrDb', coverage: 'coveragePercent', connectivity: 'connectivityPercent',
  handover: 'handoverCount', energy: 'energyJ',
}

function number(value: string): number | null { const n = Number(value.trim()); return Number.isFinite(n) ? n : null }
function canonical(name: string): string { const key = name.split(':').pop()!.split('.').pop()!; return METRIC_ALIASES[key] ?? key }

export function parseCsv(filePath: string): { metrics: Record<string, number>; series: MetricSeries[] } {
  const rows = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)
  if (!rows.length) return { metrics: {}, series: [] }
  const headers = rows[0].split(',').map((x) => x.trim())
  const series: MetricSeries[] = []
  for (let c = 0; c < headers.length; c++) {
    if (/^(time|timestamp|t)$/i.test(headers[c])) continue
    const values = rows.slice(1).map((row, i) => { const v = number(row.split(',')[c] ?? ''); return v === null ? null : { time: i, value: v } }).filter(Boolean) as {time:number;value:number}[]
    if (values.length) series.push({ name: canonical(headers[c]), unit: '', samples: values })
  }
  const metrics: Record<string, number> = {}
  for (const s of series) metrics[s.name] = s.samples[s.samples.length - 1].value
  return { metrics, series }
}

export function parseResultDirectory(resultDir: string): ResultSummary {
  const files = fs.readdirSync(resultDir).filter((f) => /\.(csv|sca|vec)$/i.test(f)).map((f) => path.join(resultDir, f))
  const metrics: Record<string, number> = {}; const series: MetricSeries[] = []
  for (const file of files) {
    if (file.toLowerCase().endsWith('.csv')) { const parsed = parseCsv(file); Object.assign(metrics, parsed.metrics); series.push(...parsed.series) }
  }
  return { metrics, series, sourceFiles: files }
}
