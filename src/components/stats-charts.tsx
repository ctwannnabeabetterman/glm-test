'use client'

/**
 * 总览页的统计图表。
 *
 * 为什么单独成文件：**这是全站唯一直接依赖 recharts 的首屏组件**。
 * recharts 的产物在客户端是一个非常重的 chunk（实测约 1.1 MB，
 * 占全部前端 JS 的六成），而它只画三张小图。
 * 之前它被内联在 `overview-section.tsx` 里，导致**打开应用的第一屏就
 * 必须下载并解析这一整个 chunk**，即使当时根本没有数据可画。
 *
 * 拆出来的目的就是让 `overview-section.tsx` 改用 `next/dynamic` 引入本文件，
 * 把 recharts 挪出首屏关键路径 —— 首屏只渲染文字与统计数字，图表 chunk
 * 在后台异步加载，到达后再补上。这样首屏可交互时间不再被它拖累。
 *
 * 改动约束：本文件只做「把数据画成图」，不引入任何新的取数逻辑。
 */

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
} from 'recharts'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { TrendingUp } from 'lucide-react'

export interface StatsChartsData {
  papers: { total: number; read: number; reading: number; unread: number }
  experiments: { total: number; completed: number; planned: number }
  milestones: { total: number; gantt: number; writing: number; submission: number }
}

export default function StatsCharts({ stats }: { stats: StatsChartsData | null }) {
  const paperStatusData = stats
    ? [
        { name: '已读', value: stats.papers.read, color: '#10b981' },
        { name: '阅读中', value: stats.papers.reading, color: '#3b82f6' },
        { name: '未读', value: stats.papers.unread, color: '#f59e0b' },
      ].filter((d) => d.value > 0)
    : []

  const expStatusData = stats
    ? [
        { name: '已完成', value: stats.experiments.completed, color: '#10b981' },
        { name: '计划中', value: stats.experiments.planned, color: '#f59e0b' },
        {
          name: '其他',
          value:
            stats.experiments.total -
            stats.experiments.completed -
            stats.experiments.planned,
          color: '#8b5cf6',
        },
      ].filter((d) => d.value > 0)
    : []

  const milestoneData = stats
    ? [
        { name: 'Gantt 任务', value: stats.milestones.gantt, color: '#3b82f6' },
        { name: '写作里程碑', value: stats.milestones.writing, color: '#8b5cf6' },
        { name: '投稿计划', value: stats.milestones.submission, color: '#ec4899' },
      ].filter((d) => d.value > 0)
    : []

  if (!stats) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          数据统计可视化
        </CardTitle>
        <CardDescription className="text-xs">
          论文阅读进度 · 实验状态 · 里程碑分布
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Paper status pie */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">
              论文阅读状态
            </div>
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
              <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
                暂无数据
              </div>
            )}
          </div>

          {/* Experiment status pie */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">
              实验状态分布
            </div>
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
              <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
                暂无数据
              </div>
            )}
          </div>

          {/* Milestone bar */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">
              里程碑类型分布
            </div>
            {milestoneData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={milestoneData}
                  layout="vertical"
                  margin={{ left: 10, right: 10 }}
                >
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
              <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
                暂无数据
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
