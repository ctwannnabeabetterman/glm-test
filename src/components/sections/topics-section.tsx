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
import { AIDirectionExplorer } from '@/components/ai-direction-explorer'
import {
  ALL_SUB_ITEMS,
  computeTotalScore,
  emptyScoreMap,
  isSubjective,
  SUBJECTIVE_ITEMS,
  type ScoreMap,
} from '@/lib/methodology/topic-ai'
import { toastAiError } from '@/lib/ai-error'
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
  Loader2,
  Info,
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
  /** 已挂到本课题的论文/笔记数（GET /api/topics?withCounts=1 才有） */
  paperCount?: number
  noteCount?: number
}

/** AI 打分结果里跟着分数一起回来的「依据量」，用来告诉用户这次结论有多实 */
interface ScoreEvidence {
  paperCount: number
  noteCount: number
  unlinkedPapers: number
  unlinkedNotes: number
}

export function TopicsSection() {
  const { data: topics, refetch, loading } = useFetch<Topic[]>('/api/topics?withCounts=1')
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
      // 先给一份全 5 分的占位表：这样课题一旦创建，卡片上就有完整的 4 维进度条
      // （而不是 0 分瘫痪状态）。真正的分数由用户在卡片上点「AI 打分」得到 ——
      // 之前这里硬编码 5 分且没有 AI 参与，用户看到一片 5 只能自己逐项调。
      const emptyScores = emptyScoreMap(5)
      await api.post('/api/topics', {
        ...newTopic,
        scores: JSON.stringify(emptyScores),
        totalScore: computeTotalScore(emptyScores),
      })
      toast.success('课题已添加，可点「AI 打分」自动评分')
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
    const rounded = computeTotalScore(scores)
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

  /** AI 打分：拿回完整分数表整块写回。用户随后改任何一项，都会覆盖 AI 的值。 */
  const handleAiScore = async (topic: Topic) => {
    const res = await fetch('/api/ai-topic-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicId: topic.id }),
    })
    const data = await res.json()
    if (!res.ok || !data.success) {
      toastAiError(data, 'AI 打分失败')
      return null
    }
    await api.put(`/api/topics/${topic.id}`, {
      scores: JSON.stringify(data.scores),
      totalScore: data.totalScore,
    })
    refetch()
    return data as {
      totalScore: number
      scored: number
      missing: string[]
      rationale: string
      evidence: ScoreEvidence
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

      {/* 先探索候选方向，再做全库 Gap 分析，避免重复选题 */}
      <AIDirectionExplorer />
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
              onAiScore={() => handleAiScore(topic)}
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

function TopicCard({ topic, rank, isEditing, onToggleEdit, onScoreChange, onAiScore, onDelete }: {
  topic: Topic
  rank: number
  isEditing: boolean
  onToggleEdit: () => void
  onScoreChange: (t: Topic, c: string, s: string, v: number) => void
  onAiScore: () => Promise<{
    totalScore: number
    scored: number
    missing: string[]
    rationale: string
    evidence: ScoreEvidence
  } | null>
  onDelete: () => void
}) {
  const scores: ScoreMap = useMemo(() => JSON.parse(topic.scores), [topic.scores])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiMeta, setAiMeta] = useState<{
    totalScore: number
    scored: number
    missing: string[]
    rationale: string
    evidence: ScoreEvidence
  } | null>(null)

  const getScore = (c: string, s: string) => scores[c]?.[s] ?? 0

  const getCritScore = (c: string) => {
    const info = TOPIC_CRITERIA[c]
    let total = 0
    Object.entries(info.subItems as Record<string, number>).forEach(([sub, w]) => {
      total += (scores[c]?.[sub] ?? 0) * w
    })
    return total
  }

  const runAiScore = async () => {
    setAiLoading(true)
    try {
      const meta = await onAiScore()
      if (meta) {
        setAiMeta(meta)
        toast.success(`AI 打分完成：${meta.totalScore.toFixed(2)} / 10，请复核 4 个主观项`)
      }
    } catch (e) {
      toast.error('AI 打分失败：' + (e as Error).message)
    } finally {
      setAiLoading(false)
    }
  }

  // 用户改动任何一项后，AI 的说明就过期了 —— 分数已经不是它给的那份，
  // 继续挂着「AI 依据 X 篇论文打的」会误导判断。
  const handleManualChange = (c: string, s: string, v: number) => {
    if (aiMeta) setAiMeta(null)
    onScoreChange(topic, c, s, v)
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
                {/* 料的多少直接决定 AI 分析与 AI 打分的可信度，所以在列表上就亮出来 */}
                {typeof topic.paperCount === 'number' && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] font-normal',
                      topic.paperCount === 0 && topic.noteCount === 0
                        ? 'border-amber-500/40 text-amber-600'
                        : 'text-muted-foreground'
                    )}
                    title={
                      topic.paperCount === 0 && topic.noteCount === 0
                        ? '这个课题还没有关联文献：AI 分析与 AI 打分都只能凭课题名称推测。到文献库给论文挂上本课题即可。'
                        : '已关联的论文与笔记数（AI 分析与 AI 打分只使用这些材料）'
                    }
                  >
                    {topic.paperCount} 篇 · {topic.noteCount} 笔记
                  </Badge>
                )}
              </div>
              {topic.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{topic.description}</p>
              )}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs bg-primary/10 text-primary hover:bg-primary/20"
              onClick={runAiScore}
              disabled={aiLoading}
            >
              {aiLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
              {aiLoading ? '打分中' : 'AI 打分'}
            </Button>
            <Button size="sm" variant={isEditing ? 'default' : 'outline'} className="h-7 text-xs" onClick={onToggleEdit}>
              {isEditing ? '完成' : '手改'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn('pt-0', !isEditing && 'hidden')}>
        <div className="space-y-3">
          {aiMeta && (
            <div className="rounded-md border border-primary/25 bg-primary/5 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                AI 打分依据
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                本次依据 {aiMeta.evidence.paperCount} 篇论文、{aiMeta.evidence.noteCount} 条笔记
                {aiMeta.evidence.unlinkedPapers > 0 && `（另有 ${aiMeta.evidence.unlinkedPapers} 篇论文未归到本课题，未参与打分）`}
                。已填 {aiMeta.scored}/14 项
                {aiMeta.missing.length > 0 && `，${aiMeta.missing.length} 项未能识别已按 5 分兜底`}。
              </div>
              {aiMeta.rationale && (
                <div className="text-[11px] leading-relaxed border-t border-primary/15 pt-1.5">{aiMeta.rationale}</div>
              )}
              <div className="flex items-start gap-1 text-[10px] text-amber-600 border-t border-primary/15 pt-1.5">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>带「确认」标记的 4 项 AI 无从知晓（实验室条件、你的时间与方向），它是按同类情况估的，请按实际改写。</span>
              </div>
            </div>
          )}
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
                      <div className="text-xs flex items-center gap-1.5">
                        {sub}
                        {isSubjective(sub) && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1 py-0 h-4 border-amber-500/40 text-amber-600"
                            title="这一项只有你自己知道（实验室条件 / 你的时间 / 你的毕业论文方向），AI 给的是同类情况估值"
                          >
                            确认
                          </Badge>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">权重 {(weight * 100).toFixed(0)}%</div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      value={getScore(crit, sub)}
                      onChange={(e) => handleManualChange(crit, sub, Number(e.target.value))}
                      className="w-32 accent-primary"
                    />
                    <div className="w-12 text-right">
                      <Input
                        type="number"
                        min="0"
                        max="10"
                        value={getScore(crit, sub)}
                        onChange={(e) => handleManualChange(crit, sub, Math.max(0, Math.min(10, Number(e.target.value))))}
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
