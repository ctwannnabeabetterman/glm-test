'use client'

import { useFetch } from '@/lib/hooks'
import { LAYER_ARCHITECTURE, VENUES, SCHOLARS } from '@/lib/methodology-data'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  BookOpen,
  Target,
  FlaskConical,
  Calendar,
  TrendingUp,
  ArrowRight,
  Radio,
  Network,
  Share2,
  Users,
  Trophy,
  Activity,
  FileText,
  Clock,
  CheckCircle2,
  Download,
  Upload,
  Database as DatabaseIcon,
  AlertTriangle,
  Search as SearchIcon,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useRef, useState } from 'react'
import { ReadingHeatmap } from '@/components/reading-heatmap'
import { ReadingGoals } from '@/components/reading-goals'
import { PaperRecommendations } from '@/components/paper-recommendations'
import { Achievements } from '@/components/achievements'
import { WidgetCustomizer, useWidgetVisibility } from '@/components/widget-customizer'
import dynamic from 'next/dynamic'

/**
 * 图表类组件一律按需加载 —— 见 `@/components/stats-charts` 文件头的说明。
 * recharts 是前端最重的一块（实测约 1.1 MB，占全站前端 JS 六成），却只画几张小图。
 * 凡是直接 import recharts 的组件都必须经 `dynamic()` 引入，否则它又会被
 * 拖回首屏 chunk，前面的拆分就白做了。
 * ⚠️ `ReadingSessionHistory` 同样依赖 recharts（别因为它名字里没有"chart"就漏掉）。
 */
const StatsCharts = dynamic(() => import('@/components/stats-charts'), {
  ssr: false,
  loading: () => (
    <div className="rounded-sm border border-border p-8 text-center text-xs text-muted-foreground">
      正在加载图表…
    </div>
  ),
})

const ReadingSessionHistory = dynamic(
  () => import('@/components/reading-session-history').then((m) => m.ReadingSessionHistory),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-sm border border-border p-8 text-center text-xs text-muted-foreground">
        正在加载阅读记录…
      </div>
    ),
  }
)

interface Stats {
  papers: { total: number; read: number; reading: number; unread: number; highPriority: number }
  topics: { total: number; top: { id: string; name: string; totalScore: number; direction: string }[] }
  experiments: { total: number; planned: number; completed: number }
  milestones: { total: number; gantt: number; writing: number; submission: number }
  notes: { total: number }
}

const LAYER_ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  Radio,
  Network,
  Share2,
}

export function OverviewSection() {
  const { data: stats, loading } = useFetch<Stats>('/api/stats')
  const setSection = useAppStore((s) => s.setSection)
  const { isVisible } = useWidgetVisibility()

  return (
    <div className="space-y-10">
      {/* ── 首屏：论文式的题头 + 摘要 ─────────────────────── */}
      {isVisible('hero') && (
        <section>
          <div className="eyebrow mb-3">AI Network Lab · 科研工作台</div>
          <h1 className="display-title max-w-4xl">AI 通信组网科研助手</h1>
          <p className="prose-research mt-4 max-w-3xl text-muted-foreground">
            面向通信组网方向的硕士研究生，把从领域认知、文献管理、实验设计到论文写作与投稿的
            全流程收纳进一个工作台。方法论 6 模块、Zotero 论文库、关键词矩阵、Gantt 图与写作
            时间线在此汇合，取代散落各处的表格与笔记。
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setSection('papers')}>
              <BookOpen className="h-4 w-4 mr-1.5" />
              进入论文库
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSection('methodology')}>
              <FileText className="h-4 w-4 mr-1.5" />
              浏览方法论
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSection('docs')}>
              使用说明
            </Button>
            <WidgetCustomizer />
          </div>
        </section>
      )}

      {/* ── 统计：空数据时整体收起，避免零值占版面 ─────────── */}
      {isVisible('quickStats') && !loading && stats && stats.papers.total + stats.topics.total + stats.experiments.total + stats.milestones.total > 0 && (
        <section>
          <hr className="rule mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
            <StatCard
              icon={BookOpen}
              label="论文总数"
              value={stats.papers.total}
              sub={`已读 ${stats.papers.read} · 阅读中 ${stats.papers.reading}`}
              onClick={() => setSection('papers')}
            />
            <StatCard
              icon={Target}
              label="评估课题"
              value={stats.topics.total}
              sub={stats.topics.top[0] ? `最高分 ${stats.topics.top[0].totalScore.toFixed(1)}` : '尚未评估'}
              onClick={() => setSection('topics')}
            />
            <StatCard
              icon={FlaskConical}
              label="实验记录"
              value={stats.experiments.total}
              sub={`完成 ${stats.experiments.completed} · 计划 ${stats.experiments.planned}`}
              onClick={() => setSection('experiments')}
            />
            <StatCard
              icon={Calendar}
              label="里程碑"
              value={stats.milestones.total}
              sub={`Gantt ${stats.milestones.gantt} · 写作 ${stats.milestones.writing}`}
              onClick={() => setSection('planner')}
            />
          </div>
        </section>
      )}

      {/* ── 三层架构：学术图表式表达，去彩色块 ──────────────── */}
      {isVisible('layerArchitecture') && (
        <section>
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <div>
              <div className="eyebrow mb-1">方法论 §1.1.1</div>
              <h2 className="section-title">AI for Wireless 三层架构</h2>
              <p className="caption mt-1">
                通信系统中引入 AI 的三个层次，由底向上：物理层 → MAC 层 → 网络层
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {[...LAYER_ARCHITECTURE].reverse().map((layer, idx) => {
              const Icon = LAYER_ICONS[layer.id] ?? Radio
              return (
                <div
                  key={layer.id}
                  className="rounded-sm border border-border bg-card"
                >
                  <div className="flex flex-col lg:flex-row lg:items-stretch">
                    {/* 层标识：左侧竖条用中性色，不用彩色渐变 */}
                    <div className="flex items-center gap-3 lg:w-52 shrink-0 border-b lg:border-b-0 lg:border-r border-border px-4 py-3">
                      <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">{layer.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {layer.nameEn}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
                      {layer.problems.map((p) => (
                        <div key={p.name} className="px-4 py-3">
                          <div className="text-[13px]">{p.name}</div>
                          <div className="caption mt-0.5">{p.ai}</div>
                        </div>
                      ))}
                    </div>

                    <div className="lg:w-44 shrink-0 flex flex-wrap items-start gap-1 border-t lg:border-t-0 lg:border-l border-border px-4 py-3">
                      {layer.metrics.map((m) => (
                        <span
                          key={m}
                          className="inline-flex items-center rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="caption mt-3">
            课程关联：{LAYER_ARCHITECTURE.map((l) => l.courseLink).join(' / ')}
          </p>
        </section>
      )}

      {/* Top topics & venues */}
      {isVisible('topTopics') && isVisible('venues') && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top topics */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              课题评估 Top
            </CardTitle>
            <CardDescription className="text-xs">方法论 §1.3 选题评估矩阵</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {stats?.topics.top.length ? (
              stats.topics.top.map((t, i) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 p-2 hover:border-primary/40 cursor-pointer transition-colors"
                  onClick={() => setSection('topics')}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 text-xs font-bold">
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{t.name}</div>
                    <div className="text-[11px] text-muted-foreground">{t.direction}</div>
                  </div>
                  <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                    {t.totalScore.toFixed(1)}
                  </Badge>
                </div>
              ))
            ) : (
              <EmptyHint text="暂无课题评分" onClick={() => setSection('topics')} />
            )}
          </CardContent>
        </Card>

        {/* Upcoming venues */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              顶会顶刊时间表
            </CardTitle>
            <CardDescription className="text-xs">方法论 §1.2.2 + §6.1 投稿阶梯</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {VENUES.slice(0, 6).map((v) => (
                <div
                  key={v.name}
                  className="rounded-md border border-border/60 p-2.5 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-xs font-semibold truncate">{v.name}</div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[11px] py-0 px-1.5',
                        v.type === 'conference' ? 'border-blue-500/30 text-blue-600' : 'border-purple-500/30 text-purple-600'
                      )}
                    >
                      {v.type === 'conference' ? '会议' : '期刊'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{v.reviewCycle}</span>
                    <span>·</span>
                    <span>{v.level}</span>
                  </div>
                  {v.note && (
                    <div className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-1">{v.note}</div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Reading progress + scholars */}
      {isVisible('readingProgress') && isVisible('scholars') && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              阅读进度
            </CardTitle>
            <CardDescription className="text-xs">方法论 §2.2.4 阅读跟踪</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {stats && (() => {
              const total = stats.papers.total || 1
              const readPct = (stats.papers.read / total) * 100
              const readingPct = (stats.papers.reading / total) * 100
              return (
                <>
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span>已读</span>
                      <span className="font-medium">{stats.papers.read} / {stats.papers.total}</span>
                    </div>
                    <Progress value={readPct} className="h-2" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span>阅读中</span>
                      <span className="font-medium">{stats.papers.reading}</span>
                    </div>
                    <Progress value={readingPct} className="h-2" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <MiniStat label="高优先级" value={stats.papers.highPriority} color="text-red-500" />
                    <MiniStat label="未读" value={stats.papers.unread} color="text-amber-500" />
                    <MiniStat label="笔记" value={stats.notes.total} color="text-blue-500" />
                  </div>
                </>
              )
            })()}
          </CardContent>
        </Card>

        {/* Scholars */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              推荐追踪学者
            </CardTitle>
            <CardDescription className="text-xs">方法论 §1.2.3 学者追踪清单</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SCHOLARS.slice(0, 6).map((s) => (
                <div
                  key={s.name}
                  className="flex items-start gap-2 rounded-md border border-border/60 p-2 hover:border-primary/40 transition-colors"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border font-mono text-[11px] font-medium text-primary">
                    {s.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{s.institution}</div>
                    <div className="text-[11px] text-muted-foreground/80 truncate">{s.direction}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Quick access to all sections */}
      {isVisible('quickAccess') && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">快捷入口 · 6 模块全流程</CardTitle>
          <CardDescription className="text-xs">点击进入对应研究阶段</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            <QuickLink label="文献检索工具" desc="关键词矩阵 · arXiv 监控" onClick={() => setSection('search')} icon={SearchIcon} />
            <QuickLink label="选题评估" desc="量化打分 + 横向对比" onClick={() => setSection('topics')} icon={Target} />
            <QuickLink label="实验管理" desc="基线检查 + 超参数 + 消融" onClick={() => setSection('experiments')} icon={FlaskConical} />
            <QuickLink label="研究规划" desc="Gantt 图 + 写作时间线" onClick={() => setSection('planner')} icon={Calendar} />
            <QuickLink label="论文写作" desc="结构检查 + 学术句式" onClick={() => setSection('writing')} icon={PenLineIcon} />
            <QuickLink label="科研笔记" desc="Obsidian 风格笔记" onClick={() => setSection('notes')} icon={NoteIcon} />
            <QuickLink label="方法论浏览" desc="6 模块完整指南" onClick={() => setSection('methodology')} icon={FileText} />
            <QuickLink label="论文库" desc="Zotero 风格管理" onClick={() => setSection('papers')} icon={BookOpen} />
          </div>
        </CardContent>
      </Card>
      )}

      {/* Stats charts */}
      {isVisible('statsCharts') && <StatsCharts stats={stats} />}

      {/* Paper recommendations */}
      {isVisible('recommendations') && <PaperRecommendations />}

      {/* Reading goals */}
      {isVisible('readingGoals') && <ReadingGoals />}

      {/* Reading heatmap */}
      {isVisible('readingHeatmap') && <ReadingHeatmap />}

      {/* Reading session history */}
      {isVisible('readingHistory') && <ReadingSessionHistory />}

      {/* Achievements */}
      {isVisible('achievements') && <Achievements />}

      {/* Data management */}
      {isVisible('dataManagement') && <DataManagement />}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, onClick }: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  value: number | string
  sub: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-card p-4 transition-colors hover:bg-muted/60"
    >
      <div className="flex items-center gap-2 mb-2.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="text-[12px]">{label}</span>
      </div>
      <div className="tabular text-[26px] font-medium leading-none tracking-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-2 truncate">{sub}</div>
    </button>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2 text-center">
      <div className={cn('text-lg font-bold', color)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function QuickLink({ label, desc, onClick, icon: Icon }: {
  label: string
  desc: string
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-2.5 rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/40 hover:bg-accent/30 card-hover"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{desc}</div>
      </div>
      <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
    </button>
  )
}

function EmptyHint({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
    >
      {text} → 点击进入
    </button>
  )
}

// ============ Data Management (Export/Import) ============
function DataManagement() {
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importData, setImportData] = useState<{ data: unknown; meta: Record<string, number> } | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/backup')
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ai-research-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${data.meta.papers + data.meta.topics + data.meta.experiments} 条数据`)
    } catch {
      toast.error('导出失败')
    } finally {
      setExporting(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        if (!parsed.data) {
          toast.error('无效的备份文件格式')
          return
        }
        setImportData({ data: parsed.data, meta: parsed.meta || {} })
        setImportOpen(true)
      } catch {
        toast.error('文件解析失败')
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be re-selected
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleImport = async () => {
    if (!importData) return
    setImporting(true)
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: importData.data, mode: importMode }),
      })
      const result = await res.json()
      if (result.success) {
        toast.success(`导入成功：${Object.entries(result.results).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
        setImportOpen(false)
        setImportData(null)
        // Reload to refresh data
        setTimeout(() => window.location.reload(), 1000)
      } else {
        toast.error('导入失败')
      }
    } catch {
      toast.error('导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <DatabaseIcon className="h-4 w-4 text-primary" />
          数据管理
        </CardTitle>
        <CardDescription className="text-xs">导出/导入 JSON 备份，跨设备同步科研数据</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Export */}
          <div className="rounded-lg border border-border/60 p-3 hover:border-primary/40 transition-colors">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 shrink-0">
                <Download className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">导出备份</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  将所有论文、课题、实验、里程碑、笔记、检索记录导出为 JSON 文件
                </div>
                <Button
                  size="sm"
                  className="mt-2 h-7 text-xs"
                  onClick={handleExport}
                  disabled={exporting}
                >
                  {exporting ? (
                    <><Activity className="h-3 w-3 mr-1 animate-spin" /> 导出中...</>
                  ) : (
                    <><Download className="h-3 w-3 mr-1" /> 导出 JSON</>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Import */}
          <div className="rounded-lg border border-border/60 p-3 hover:border-primary/40 transition-colors">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
                <Upload className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">导入备份</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  从 JSON 文件恢复数据，支持合并模式或替换模式
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs"
                  onClick={() => fileRef.current?.click()}
                  disabled={importing}
                >
                  <Upload className="h-3 w-3 mr-1" /> 选择 JSON 文件
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) setImportData(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认导入数据</DialogTitle>
              <DialogDescription>请选择导入模式并确认</DialogDescription>
            </DialogHeader>
            {importData && (
              <div className="space-y-3">
                <div className="rounded-md bg-muted/50 p-3">
                  <div className="text-xs font-medium mb-2">备份内容：</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {Object.entries(importData.meta).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{k}:</span>
                        <span className="font-medium">{v as number}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium mb-2">导入模式：</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setImportMode('merge')}
                      className={cn(
                        'rounded-md border p-2 text-left transition-all',
                        importMode === 'merge'
                          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      <div className="text-xs font-medium">合并模式</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        保留现有数据，按 ID 更新或新增
                      </div>
                    </button>
                    <button
                      onClick={() => setImportMode('replace')}
                      className={cn(
                        'rounded-md border p-2 text-left transition-all',
                        importMode === 'replace'
                          ? 'border-red-500 bg-red-500/10 ring-1 ring-red-500/30'
                          : 'border-border hover:border-red-500/40'
                      )}
                    >
                      <div className="text-xs font-medium text-red-600">替换模式</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        ⚠️ 清空所有现有数据后导入
                      </div>
                    </button>
                  </div>
                </div>

                {importMode === 'replace' && (
                  <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-red-700 dark:text-red-400">
                      替换模式将<strong>永久删除</strong>所有现有数据，然后导入备份内容。此操作不可撤销！
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setImportOpen(false); setImportData(null) }}>取消</Button>
              <Button
                onClick={handleImport}
                disabled={importing}
                variant={importMode === 'replace' ? 'destructive' : 'default'}
              >
                {importing ? '导入中...' : `确认${importMode === 'replace' ? '替换' : '合并'}导入`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

function PenLineIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function NoteIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
