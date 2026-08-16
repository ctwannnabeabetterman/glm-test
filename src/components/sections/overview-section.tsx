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
import { ReadingSessionHistory } from '@/components/reading-session-history'
import { WidgetCustomizer, useWidgetVisibility } from '@/components/widget-customizer'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'

interface Stats {
  papers: { total: number; read: number; reading: number; unread: number; highPriority: number }
  topics: { total: number; top: { id: string; name: string; totalScore: number; direction: string }[] }
  experiments: { total: number; planned: number; completed: number }
  milestones: { total: number; gantt: number; writing: number; submission: number }
  notes: { total: number }
}

const LAYER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Radio,
  Network,
  Share2,
}

export function OverviewSection() {
  const { data: stats, loading } = useFetch<Stats>('/api/stats')
  const setSection = useAppStore((s) => s.setSection)
  const { isVisible } = useWidgetVisibility()

  return (
    <div className="space-y-6">
      {/* Hero header */}
      {isVisible('hero') && (
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/8 via-primary/4 to-transparent p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-primary/15 text-primary border-primary/20">
                <Activity className="h-3 w-3 mr-1" />
                6 模块 · 全流程
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                硕士研究生 · 通信组网方向
              </Badge>
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
              <span className="gradient-text">AI 通信组网</span> 科研助手
            </h1>
            <p className="text-sm text-muted-foreground">
              从领域认知、文献管理、实验设计到论文写作与投稿，将方法论 6 模块、Zotero 论文库、关键词矩阵、Gantt 图、写作时间线等可视化为一站式仪表盘。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" onClick={() => setSection('papers')}>
              <BookOpen className="h-4 w-4 mr-1.5" />
              进入论文库
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSection('methodology')}>
              <FileText className="h-4 w-4 mr-1.5" />
              浏览方法论
            </Button>
            <WidgetCustomizer />
          </div>
        </div>
      </div>
      )}

      {/* Quick stats */}
      {isVisible('quickStats') && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={BookOpen}
          label="论文总数"
          value={loading ? '—' : stats?.papers.total ?? 0}
          sub={`已读 ${stats?.papers.read ?? 0} · 阅读中 ${stats?.papers.reading ?? 0}`}
          color="#10b981"
          onClick={() => setSection('papers')}
        />
        <StatCard
          icon={Target}
          label="评估课题"
          value={loading ? '—' : stats?.topics.total ?? 0}
          sub={`Top: ${(stats?.topics.top[0]?.name ?? '—').slice(0, 14)}…`}
          color="#f59e0b"
          onClick={() => setSection('topics')}
        />
        <StatCard
          icon={FlaskConical}
          label="实验记录"
          value={loading ? '—' : stats?.experiments.total ?? 0}
          sub={`完成 ${stats?.experiments.completed ?? 0} · 计划 ${stats?.experiments.planned ?? 0}`}
          color="#8b5cf6"
          onClick={() => setSection('experiments')}
        />
        <StatCard
          icon={Calendar}
          label="里程碑"
          value={loading ? '—' : stats?.milestones.total ?? 0}
          sub={`Gantt ${stats?.milestones.gantt ?? 0} · 写作 ${stats?.milestones.writing ?? 0}`}
          color="#ec4899"
          onClick={() => setSection('planner')}
        />
      </div>
      )}

      {/* 3-layer architecture diagram */}
      {isVisible('layerArchitecture') && (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                AI for Wireless 三层架构
              </CardTitle>
              <CardDescription className="mt-1">
                通信系统中引入 AI 的三个层次，由底向上：物理层 → MAC 层 → 网络层
              </CardDescription>
            </div>
            <Badge variant="outline" className="hidden sm:inline-flex text-xs">
              方法论 §1.1.1
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...LAYER_ARCHITECTURE].reverse().map((layer, idx) => {
              const Icon = LAYER_ICONS[layer.id] ?? Radio
              return (
                <div
                  key={layer.id}
                  className="relative rounded-xl border-2 p-4 transition-all hover:shadow-md"
                  style={{
                    borderColor: `${layer.color}40`,
                    background: `linear-gradient(135deg, ${layer.color}10, ${layer.color}05)`,
                  }}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    <div className="flex items-center gap-3 lg:w-56 shrink-0">
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-lg shadow-sm"
                        style={{ background: layer.color, color: 'white' }}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{layer.name}</div>
                        <div className="text-[11px] text-muted-foreground">{layer.nameEn}</div>
                      </div>
                    </div>

                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                      {layer.problems.map((p) => (
                        <div
                          key={p.name}
                          className="rounded-md bg-background/60 px-3 py-2 border border-border/50"
                        >
                          <div className="text-xs font-medium">{p.name}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{p.ai}</div>
                        </div>
                      ))}
                    </div>

                    <div className="lg:w-40 shrink-0 flex flex-wrap gap-1 items-end">
                      {layer.metrics.map((m) => (
                        <Badge
                          key={m}
                          variant="secondary"
                          className="text-[10px] py-0.5"
                          style={{ background: `${layer.color}18`, color: layer.color }}
                        >
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {idx < LAYER_ARCHITECTURE.length - 1 && (
                    <div
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 rounded-full bg-background border border-border text-muted-foreground"
                      style={{ color: layer.color }}
                    >
                      ↑ 上层依赖
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-4 text-xs text-muted-foreground flex items-center gap-2 px-1">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            课程关联：{LAYER_ARCHITECTURE.map((l) => l.courseLink).join(' / ')}
          </div>
        </CardContent>
      </Card>
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
                    <div className="text-[10px] text-muted-foreground">{t.direction}</div>
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
                        'text-[9px] py-0 px-1.5',
                        v.type === 'conference' ? 'border-blue-500/30 text-blue-600' : 'border-purple-500/30 text-purple-600'
                      )}
                    >
                      {v.type === 'conference' ? '会议' : '期刊'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{v.reviewCycle}</span>
                    <span>·</span>
                    <span>{v.level}</span>
                  </div>
                  {v.note && (
                    <div className="text-[10px] text-muted-foreground/80 mt-1 line-clamp-1">{v.note}</div>
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
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 text-xs font-semibold text-purple-600">
                    {s.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{s.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{s.institution}</div>
                    <div className="text-[10px] text-muted-foreground/80 truncate">{s.direction}</div>
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

function StatCard({ icon: Icon, label, value, sub, color, onClick }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
  sub: string
  color: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md card-hover"
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: `${color}15`, color }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      <div className="text-[10px] text-muted-foreground/80 mt-1 truncate">{sub}</div>
    </button>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2 text-center">
      <div className={cn('text-lg font-bold', color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
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
        <div className="text-[10px] text-muted-foreground truncate">{desc}</div>
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

// ============ Stats Charts ============
function StatsCharts({ stats }: { stats: Stats | null }) {
  // Paper status distribution
  const paperStatusData = stats ? [
    { name: '已读', value: stats.papers.read, color: '#10b981' },
    { name: '阅读中', value: stats.papers.reading, color: '#3b82f6' },
    { name: '未读', value: stats.papers.unread, color: '#f59e0b' },
  ].filter((d) => d.value > 0) : []

  // Experiment status distribution
  const expStatusData = stats ? [
    { name: '已完成', value: stats.experiments.completed, color: '#10b981' },
    { name: '计划中', value: stats.experiments.planned, color: '#f59e0b' },
    { name: '其他', value: stats.experiments.total - stats.experiments.completed - stats.experiments.planned, color: '#8b5cf6' },
  ].filter((d) => d.value > 0) : []

  // Milestone distribution
  const milestoneData = stats ? [
    { name: 'Gantt 任务', value: stats.milestones.gantt, color: '#3b82f6' },
    { name: '写作里程碑', value: stats.milestones.writing, color: '#8b5cf6' },
    { name: '投稿计划', value: stats.milestones.submission, color: '#ec4899' },
  ].filter((d) => d.value > 0) : []

  if (!stats) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          数据统计可视化
        </CardTitle>
        <CardDescription className="text-xs">论文阅读进度 · 实验状态 · 里程碑分布</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Paper status pie */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">论文阅读状态</div>
            {paperStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={paperStatusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    innerRadius={30}
                    label={(entry) => `${entry.name}: ${entry.value}`}
                    labelLine={false}
                    fontSize={10}
                  >
                    {paperStatusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>
            )}
          </div>

          {/* Experiment status pie */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">实验状态分布</div>
            {expStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={expStatusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    innerRadius={30}
                    label={(entry) => `${entry.name}: ${entry.value}`}
                    labelLine={false}
                    fontSize={10}
                  >
                    {expStatusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>
            )}
          </div>

          {/* Milestone bar */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">里程碑类型分布</div>
            {milestoneData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={milestoneData} layout="vertical" margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                  <XAxis type="number" fontSize={10} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={70} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {milestoneData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
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
                      <div className="text-[10px] text-muted-foreground mt-0.5">
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
                      <div className="text-[10px] text-muted-foreground mt-0.5">
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
