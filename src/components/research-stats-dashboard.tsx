'use client'

import { useFetch } from '@/lib/hooks'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BarChart3, TrendingUp, Tag, Clock, Target } from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
  Cell,
} from 'recharts'

interface StatsData {
  yearData: Array<{ year: number; count: number }>
  categoryData: Array<{ category: string; count: number }>
  statusData: Array<{ status: string; count: number }>
  topTags: Array<{ tag: string; count: number }>
  scatterData: Array<{ name: string; relevance: number; novelty: number; year: number }>
  expStatusData: Array<{ status: string; count: number }>
  readingTimeByPaper: Array<{ title: string; time: number }>
  topicScores: Array<{ name: string; score: number }>
  milestoneProgress: Array<{ title: string; progress: number; type: string }>
  summary: {
    totalPapers: number
    totalTopics: number
    totalExperiments: number
    totalNotes: number
    totalMilestones: number
    totalReadingTime: number
    totalSessions: number
    avgRelevance: number
    avgNovelty: number
  }
}

const CATEGORY_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
const STATUS_COLORS: Record<string, string> = {
  read: '#10b981',
  reading: '#3b82f6',
  unread: '#f59e0b',
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const CATEGORY_LABELS: Record<string, string> = {
  survey: '综述',
  baseline: '基线',
  method: '方法',
  application: '应用',
  other: '其他',
  '': '其他',
}

export function ResearchStatsDashboard() {
  const { data, loading } = useFetch<StatsData>('/api/research-stats')

  if (loading || !data) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">加载统计数据...</CardContent></Card>
  }

  const s = data.summary

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <SummaryCard label="论文" value={s.totalPapers} icon="📚" color="text-emerald-600" />
        <SummaryCard label="课题" value={s.totalTopics} icon="🎯" color="text-amber-600" />
        <SummaryCard label="实验" value={s.totalExperiments} icon="🧪" color="text-purple-600" />
        <SummaryCard label="笔记" value={s.totalNotes} icon="📝" color="text-blue-600" />
        <SummaryCard label="阅读时长" value={formatDuration(s.totalReadingTime)} icon="⏰" color="text-orange-600" />
      </div>

      {/* Papers by year - Line chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            论文年份分布
          </CardTitle>
          <CardDescription className="text-xs">按发表年份统计论文数量</CardDescription>
        </CardHeader>
        <CardContent>
          {data.yearData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.yearData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="year" fontSize={10} />
                <YAxis fontSize={10} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Papers by category - Bar chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              论文分类分布
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.categoryData.map((d) => ({ ...d, label: CATEGORY_LABELS[d.category] || d.category }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="label" fontSize={10} />
                  <YAxis fontSize={10} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.categoryData.map((_, i) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>

        {/* Top tags - Bar chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              热门标签 Top 10
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topTags.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.topTags} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                  <XAxis type="number" fontSize={10} />
                  <YAxis type="category" dataKey="tag" fontSize={9} width={80} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">暂无标签</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Relevance vs Novelty scatter */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            相关度 vs 新颖度 散点图
          </CardTitle>
          <CardDescription className="text-xs">每点代表一篇论文 · 颜色按年份</CardDescription>
        </CardHeader>
        <CardContent>
          {data.scatterData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" dataKey="relevance" name="相关度" domain={[0, 10]} fontSize={10} label={{ value: '相关度', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                <YAxis type="number" dataKey="novelty" name="新颖度" domain={[0, 10]} fontSize={10} label={{ value: '新颖度', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  cursor={{ strokeDasharray: '3 3' }}
                  formatter={(value: number, name: string) => [value, name === 'relevance' ? '相关度' : name === 'novelty' ? '新颖度' : name]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.name || ''}
                />
                <Scatter data={data.scatterData}>
                  {data.scatterData.map((entry, i) => {
                    const color = entry.year >= 2023 ? '#10b981' : entry.year >= 2021 ? '#3b82f6' : '#f59e0b'
                    return <Cell key={i} fill={color} />
                  })}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>
          )}
          <div className="flex items-center gap-3 justify-center mt-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> 2023+</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> 2021-2022</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> 2020及更早</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Topic scores */}
        {data.topicScores.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                课题评分对比
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.topicScores} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                  <XAxis type="number" domain={[0, 10]} fontSize={10} />
                  <YAxis type="category" dataKey="name" fontSize={9} width={100} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]} fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Reading time by paper */}
        {data.readingTimeByPaper.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                阅读时长 Top 5 (分钟)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.readingTimeByPaper} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                  <XAxis type="number" fontSize={10} unit="m" />
                  <YAxis type="category" dataKey="title" fontSize={9} width={120} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="time" radius={[0, 4, 4, 0]} fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Averages */}
      <Card>
        <CardContent className="p-3 flex items-center justify-around text-center">
          <div>
            <div className="text-xl font-bold text-emerald-600">{s.avgRelevance}</div>
            <div className="text-[10px] text-muted-foreground">平均相关度</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div>
            <div className="text-xl font-bold text-blue-600">{s.avgNovelty}</div>
            <div className="text-[10px] text-muted-foreground">平均新颖度</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div>
            <div className="text-xl font-bold text-purple-600">{s.totalSessions}</div>
            <div className="text-[10px] text-muted-foreground">阅读会话数</div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div>
            <div className="text-xl font-bold text-amber-600">{s.totalMilestones}</div>
            <div className="text-[10px] text-muted-foreground">里程碑数</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-2.5 text-center">
      <div className="text-lg mb-0.5">{icon}</div>
      <div className={`text-base font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
