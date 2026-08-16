'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionHeader } from './papers-section'
import { TOPIC_CRITERIA, TOPIC_DIRECTIONS } from '@/lib/methodology-data'
import { AIGapAnalysis } from '@/components/ai-gap-analysis'
import {
  Target,
  Plus,
  Trash2,
  Star,
  TrendingUp,
  Award,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Topic {
  id: string
  name: string
  direction: string
  description: string
  scores: string // JSON
  totalScore: number
}

type ScoreMap = Record<string, Record<string, number>>

export function TopicsSection() {
  const { data: topics, refetch, loading } = useFetch<Topic[]>('/api/topics')
  const api = useApi()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newTopic, setNewTopic] = useState({
    name: '',
    direction: '物理层',
    description: '',
  })

  const handleAdd = async () => {
    if (!newTopic.name.trim()) {
      toast.error('请填写课题名称')
      return
    }
    try {
      const emptyScores: ScoreMap = {}
      Object.entries(TOPIC_CRITERIA).forEach(([crit, info]) => {
        emptyScores[crit] = {}
        Object.keys(info.subItems).forEach((sub) => {
          emptyScores[crit][sub] = 5
        })
      })
      await api.post('/api/topics', {
        ...newTopic,
        scores: JSON.stringify(emptyScores),
        totalScore: 5,
      })
      toast.success('课题已添加')
      setAddOpen(false)
      setNewTopic({ name: '', direction: '物理层', description: '' })
      refetch()
    } catch {
      toast.error('添加失败')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该课题？')) return
    try {
      await api.del(`/api/topics/${id}`)
      toast.success('已删除')
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleScoreChange = async (topic: Topic, criterion: string, subItem: string, value: number) => {
    const scores: ScoreMap = JSON.parse(topic.scores)
    scores[criterion][subItem] = value
    // Recompute total
    let total = 0
    Object.entries(TOPIC_CRITERIA).forEach(([crit, info]) => {
      let critScore = 0
      Object.entries(info.subItems).forEach(([sub, weight]) => {
        critScore += (scores[crit]?.[sub] ?? 0) * weight
      })
      total += critScore * info.weight
    })
    const rounded = Math.round(total * 100) / 100
    try {
      await api.put(`/api/topics/${topic.id}`, {
        scores: JSON.stringify(scores),
        totalScore: rounded,
      })
      refetch()
    } catch {
      toast.error('更新失败')
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="选题评估"
        desc="量化打分矩阵 · 创新性/可行性/发表价值/可持续性 四维评估"
        icon={Target}
        action={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                新增课题
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新增课题评估</DialogTitle>
                <DialogDescription>方法论 §1.3 选题评估矩阵</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>课题名称 *</Label>
                  <Input value={newTopic.name} onChange={(e) => setNewTopic({ ...newTopic, name: e.target.value })} placeholder="基于DRL的RIS辅助无线资源分配" />
                </div>
                <div>
                  <Label>研究方向</Label>
                  <Select value={newTopic.direction} onValueChange={(v) => setNewTopic({ ...newTopic, direction: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="物理层">物理层</SelectItem>
                      <SelectItem value="MAC层">MAC层</SelectItem>
                      <SelectItem value="网络层">网络层</SelectItem>
                      <SelectItem value="跨层">跨层</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>描述</Label>
                  <Textarea
                    value={newTopic.description}
                    onChange={(e) => setNewTopic({ ...newTopic, description: e.target.value })}
                    rows={3}
                    placeholder="简要描述研究问题和方法..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
                <Button onClick={handleAdd}>添加</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* AI Gap Analysis */}
      <AIGapAnalysis />

      {/* Theory card */}
      <Card className="bg-gradient-to-br from-amber-500/8 to-transparent border-amber-500/20">
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-2">方法论 §1.3.1 创新性三维模型</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <InnovationCard label="问题新" desc="研究前人未解决的问题" difficulty="⭐⭐⭐ 较难" />
            <InnovationCard label="方法新" desc="新 AI 方法解决现有问题" difficulty="⭐⭐⭐⭐ 适中" />
            <InnovationCard label="场景新" desc="现有方法应用在新场景" difficulty="⭐⭐⭐⭐⭐ 较易" />
            <InnovationCard label="组合新" desc="两个已知要素的组合创新" difficulty="⭐⭐⭐⭐ 适中" />
          </div>
        </CardContent>
      </Card>

      {/* Topics list with scoring */}
      {loading ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">加载中...</CardContent></Card>
      ) : !topics || topics.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            暂无课题，点击右上角新增
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {topics.map((topic, idx) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              rank={idx + 1}
              isEditing={editingId === topic.id}
              onToggleEdit={() => setEditingId(editingId === topic.id ? null : topic.id)}
              onScoreChange={handleScoreChange}
              onDelete={() => handleDelete(topic.id)}
            />
          ))}
        </div>
      )}

      {/* Comparison: typical 4 directions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Award className="h-4 w-4 text-amber-500" />
            四个典型课题方向对比
          </CardTitle>
          <CardDescription className="text-xs">方法论 §1.3.4</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-2">维度</th>
                  {TOPIC_DIRECTIONS.map((d) => (
                    <th key={d.name} className="text-left py-2 px-2">{d.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="与课程关联" values={TOPIC_DIRECTIONS.map((d) => '⭐'.repeat(d.courseLink))} />
                <Row label="发表空间" values={TOPIC_DIRECTIONS.map((d) => d.publishSpace)} />
                <Row label="竞争程度" values={TOPIC_DIRECTIONS.map((d) => d.competition)} />
                <Row label="代码可复用" values={TOPIC_DIRECTIONS.map((d) => d.codeReuse)} />
                <Row label="仿真链路" values={TOPIC_DIRECTIONS.map((d) => d.simChain)} />
                <Row label="推荐指数" values={TOPIC_DIRECTIONS.map((d) => '★'.repeat(d.rating))} />
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function TopicCard({ topic, rank, isEditing, onToggleEdit, onScoreChange, onDelete }: {
  topic: Topic
  rank: number
  isEditing: boolean
  onToggleEdit: () => void
  onScoreChange: (t: Topic, c: string, s: string, v: number) => void
  onDelete: () => void
}) {
  const scores: ScoreMap = useMemo(() => JSON.parse(topic.scores), [topic.scores])

  const getScore = (c: string, s: string) => scores[c]?.[s] ?? 0

  const getCritScore = (c: string) => {
    const info = TOPIC_CRITERIA[c]
    let total = 0
    Object.entries(info.subItems as Record<string, number>).forEach(([sub, w]) => {
      total += (scores[c]?.[sub] ?? 0) * w
    })
    return total
  }

  const rankBadge = rank === 1 ? 'bg-amber-500 text-white' : rank === 2 ? 'bg-slate-400 text-white' : rank === 3 ? 'bg-orange-700 text-white' : 'bg-muted text-muted-foreground'

  return (
    <Card className={cn('overflow-hidden', rank === 1 && 'border-amber-500/40')}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={cn('flex h-9 w-9 items-center justify-center rounded-full font-bold text-xs shrink-0', rankBadge)}>
              #{rank}
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base leading-tight">{topic.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className="text-[10px]">{topic.direction}</Badge>
                <Badge variant="secondary" className="text-xs bg-primary/15 text-primary font-bold">
                  <Star className="h-2.5 w-2.5 mr-0.5 fill-current" />
                  {topic.totalScore.toFixed(2)} / 10
                </Badge>
              </div>
              {topic.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{topic.description}</p>
              )}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant={isEditing ? 'default' : 'outline'} className="h-7 text-xs" onClick={onToggleEdit}>
              {isEditing ? '完成' : '打分'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn('pt-0', !isEditing && 'hidden')}>
        <div className="space-y-3">
          {Object.entries(TOPIC_CRITERIA).map(([crit, info]) => (
            <div key={crit} className="rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{crit}</span>
                  <Badge variant="outline" className="text-[10px]">权重 {(info.weight * 100).toFixed(0)}%</Badge>
                </div>
                <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                  {getCritScore(crit).toFixed(2)}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {Object.entries(info.subItems).map(([sub, weight]) => (
                  <div key={sub} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs">{sub}</div>
                      <div className="text-[10px] text-muted-foreground">权重 {(weight * 100).toFixed(0)}%</div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      value={getScore(crit, sub)}
                      onChange={(e) => onScoreChange(topic, crit, sub, Number(e.target.value))}
                      className="w-32 accent-primary"
                    />
                    <div className="w-12 text-right">
                      <Input
                        type="number"
                        min="0"
                        max="10"
                        value={getScore(crit, sub)}
                        onChange={(e) => onScoreChange(topic, crit, sub, Math.max(0, Math.min(10, Number(e.target.value))))}
                        className="h-7 text-xs w-12"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-md bg-primary/8 border border-primary/20 p-3 text-center">
            <div className="text-xs text-muted-foreground">综合评分</div>
            <div className="text-2xl font-bold gradient-text">{topic.totalScore.toFixed(2)} / 10</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {topic.totalScore >= 8 ? '⭐ 优秀课题，强烈推荐' :
               topic.totalScore >= 6.5 ? '✓ 良好课题，建议推进' :
               topic.totalScore >= 5 ? '△ 一般课题，需评估' :
               '✗ 风险较高，需调整'}
            </div>
          </div>
        </div>
      </CardContent>
      {!isEditing && (
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(TOPIC_CRITERIA).map(([crit]) => (
              <div key={crit} className="rounded-md border border-border/40 p-2 text-center">
                <div className="text-[10px] text-muted-foreground">{crit}</div>
                <div className="text-sm font-bold">{getCritScore(crit).toFixed(1)}</div>
                <Progress value={getCritScore(crit) * 10} className="h-1 mt-1" />
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

function Row({ label, values }: { label: string; values: string[] }) {
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 pr-2 text-muted-foreground">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="py-2 px-2">{v}</td>
      ))}
    </tr>
  )
}

function InnovationCard({ label, desc, difficulty }: { label: string; desc: string; difficulty: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2.5 bg-card">
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
      <div className="text-[10px] text-amber-600 mt-1">{difficulty}</div>
    </div>
  )
}
