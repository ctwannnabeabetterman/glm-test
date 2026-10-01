'use client'

import { useFetch, useApi } from '@/lib/hooks'
import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
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
import { SectionHeader, PanelHeader, MethodNote } from '@/components/section-header'
import { BASELINE_LEVELS, METRICS } from '@/lib/methodology-data'
import { AIExperimentAdvisor } from '@/components/ai-experiment-advisor'
import {
  FlaskConical,
  Plus,
  Trash2,
  Settings,
  CheckCircle2,
  TrendingUp,
  Beaker,
  Cpu,
  Calendar,
  PlayCircle,
  StopCircle,
  ChartBar,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'

interface Experiment {
  id: string
  name: string
  topic: string
  status: string
  config: string
  metrics: string
  baselines: string
  ablations: string
  notes: string
  seed: number
  createdAt: string
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  /* 单一强调色：计划 → 运行 → 完成 用明度递进；只有「失败」用 destructive */
  planned: { label: '计划中', color: 'text-muted-foreground', bg: 'bg-muted', icon: Calendar },
  running: { label: '运行中', color: 'text-accent-foreground', bg: 'bg-accent', icon: PlayCircle },
  completed: { label: '已完成', color: 'text-primary', bg: 'bg-primary/10', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-destructive', bg: 'bg-destructive/10', icon: StopCircle },
}

export function ExperimentsSection() {
  const { data: experiments, refetch, loading } = useFetch<Experiment[]>('/api/experiments')
  const api = useApi()
  const [selected, setSelected] = useState<Experiment | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newExp, setNewExp] = useState({
    name: '',
    topic: '',
    status: 'planned',
    seed: 42,
  })

  const handleAdd = async () => {
    if (!newExp.name.trim()) {
      toast.error('请填写实验名称')
      return
    }
    try {
      const created = await api.post('/api/experiments', {
        ...newExp,
        config: JSON.stringify({ model: 'DQN', lr: 0.001, batch_size: 64, hidden_dim: 128, gamma: 0.99 }),
        metrics: JSON.stringify({}),
        baselines: JSON.stringify([]),
        ablations: JSON.stringify([]),
        notes: '',
      })
      toast.success('实验已创建')
      setAddOpen(false)
      setNewExp({ name: '', topic: '', status: 'planned', seed: 42 })
      refetch()
      setSelected(created)
    } catch {
      toast.error('创建失败')
    }
  }

  const handleStatus = async (exp: Experiment, status: string) => {
    try {
      await api.put(`/api/experiments/${exp.id}`, { status })
      toast.success(`状态更新为「${STATUS_STYLES[status]?.label}」`)
      refetch()
      if (selected?.id === exp.id) setSelected({ ...exp, status })
    } catch {
      toast.error('更新失败')
    }
  }

  const handleDelete = async (exp: Experiment) => {
    if (!confirm(`确认删除实验「${exp.name}」？`)) return
    try {
      await api.del(`/api/experiments/${exp.id}`)
      toast.success('已删除')
      if (selected?.id === exp.id) setSelected(null)
      refetch()
    } catch {
      toast.error('删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="实验管理"
        desc="基线完整性检查 · 超参数网格 · 消融实验 · 结果可视化"
        icon={FlaskConical}
        action={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                新建实验
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建实验</DialogTitle>
                <DialogDescription>方法论 §3.3 实验记录规范</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>实验名称 *</Label>
                  <Input value={newExp.name} onChange={(e) => setNewExp({ ...newExp, name: e.target.value })} placeholder="DQN Power Control - lr=0.001" />
                </div>
                <div>
                  <Label>所属课题</Label>
                  <Input value={newExp.topic} onChange={(e) => setNewExp({ ...newExp, topic: e.target.value })} placeholder="基于DRL的RIS辅助..." />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>状态</Label>
                    <Select value={newExp.status} onValueChange={(v) => setNewExp({ ...newExp, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="planned">计划中</SelectItem>
                        <SelectItem value="running">运行中</SelectItem>
                        <SelectItem value="completed">已完成</SelectItem>
                        <SelectItem value="failed">失败</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>随机种子</Label>
                    <Input type="number" value={newExp.seed} onChange={(e) => setNewExp({ ...newExp, seed: Number(e.target.value) })} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
                <Button onClick={handleAdd}>创建</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Baseline theory card */}
      <Card className="border-l-2 border-l-primary/60 bg-card py-0">
        <CardContent className="p-4">
          <div className="eyebrow mb-2">方法论 §3.1.1 基线对比三层原则</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {BASELINE_LEVELS.map((b) => (
              <div key={b.level} className="list-row p-2.5">
                <div className="text-xs font-semibold">{b.name}</div>
                <div className="text-[12px] leading-relaxed text-muted-foreground mt-0.5">{b.desc}</div>
                {/* 「必须」是要求而不是危险 ⇒ 强调色描边，红色留给破坏性操作 */}
                {b.required && <Badge variant="outline" className="rounded-sm text-[11px] font-normal mt-1 border-primary/40 text-primary">必须对比</Badge>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Experiment Advisor */}
      <AIExperimentAdvisor />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
            实验列表
          </TabsTrigger>
          <TabsTrigger value="detail">
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            详情配置
          </TabsTrigger>
          <TabsTrigger value="viz">
            <ChartBar className="h-3.5 w-3.5 mr-1.5" />
            可视化模板
          </TabsTrigger>
          <TabsTrigger value="metrics">
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            性能指标
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-2">
          {loading ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">加载中...</CardContent></Card>
          ) : !experiments || experiments.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">暂无实验</CardContent>
            </Card>
          ) : (
            experiments.map((exp) => {
              const st = STATUS_STYLES[exp.status] ?? STATUS_STYLES.planned
              const config = JSON.parse(exp.config)
              const metrics = JSON.parse(exp.metrics)
              const baselines = normalizeBaselines(JSON.parse(exp.baselines))
              const ablations = normalizeAblations(JSON.parse(exp.ablations))
              const Icon = st.icon
              return (
                /* 行内有下拉与删除按钮 ⇒ 外层保持 div + onClick；实验名用无处理器的 button，
                   click / Enter 冒泡到外层（与论文库 PaperRow 同一手法） */
                <div
                  key={exp.id}
                  className={cn('list-row card-hover cursor-pointer p-3', selected?.id === exp.id && 'border-primary ring-1 ring-primary/30')}
                  onClick={() => setSelected(exp)}
                >
                    <div className="flex items-start gap-3">
                      <div className={cn('flex h-9 w-9 items-center justify-center rounded-sm shrink-0', st.bg, st.color)} aria-hidden="true">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <button
                            type="button"
                            aria-pressed={selected?.id === exp.id}
                            className="rounded-sm text-left text-sm font-medium hover:text-primary"
                          >
                            {exp.name}
                          </button>
                          <Badge variant="outline" className={cn('rounded-sm text-[11px] font-normal', st.bg, st.color, 'border-transparent')}>{st.label}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{exp.topic || '未指定课题'}</div>
                        <div className="tabular flex flex-wrap gap-2 mt-1.5 text-[11px] text-muted-foreground">
                          {config.model && <Badge variant="outline" className="rounded-sm text-[11px] font-normal py-0">模型: {config.model}</Badge>}
                          {config.lr && <Badge variant="outline" className="rounded-sm text-[11px] font-mono font-normal py-0">LR: {config.lr}</Badge>}
                          {config.batch_size && <Badge variant="outline" className="rounded-sm text-[11px] font-mono font-normal py-0">BS: {config.batch_size}</Badge>}
                          <Badge variant="outline" className="rounded-sm text-[11px] font-mono font-normal py-0">Seed: {exp.seed}</Badge>
                          <Badge variant="outline" className="rounded-sm text-[11px] font-normal py-0">基线: {baselines.length}</Badge>
                          <Badge variant="outline" className="rounded-sm text-[11px] font-normal py-0">消融: {ablations.length}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Select value={exp.status} onValueChange={(v) => handleStatus(exp, v)}>
                          <SelectTrigger className="h-7 w-[100px] text-xs" aria-label="实验状态"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="planned">计划中</SelectItem>
                            <SelectItem value="running">运行中</SelectItem>
                            <SelectItem value="completed">已完成</SelectItem>
                            <SelectItem value="failed">失败</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          aria-label={`删除实验 ${exp.name}`}
                          onClick={() => handleDelete(exp)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                </div>
              )
            })
          )}
        </TabsContent>

        <TabsContent value="detail">
          {selected ? (
            <ExperimentDetail exp={selected} onUpdate={(u) => { setSelected(u); refetch() }} />
          ) : (
            <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">点击列表选择实验</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="viz">
          <VisualizationTemplates />
        </TabsContent>

        <TabsContent value="metrics">
          <MetricsReference />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Normalize baselines: handle both string[] and {level,name,status}[] formats
type Baseline = { level: string; name: string; status?: string }
type Ablation = { name: string; impact?: number }

function normalizeBaselines(raw: unknown): Baseline[] {
  if (!Array.isArray(raw)) return []
  return raw.map((b) => {
    if (typeof b === 'string') {
      // Legacy format: plain string — infer level from known defaults
      const level = inferBaselineLevel(b)
      return { level, name: b, status: 'pending' as const }
    }
    return b as Baseline
  })
}

function inferBaselineLevel(name: string): string {
  const traditional = ['WMMSE', 'MMSE', 'FP', 'LS', 'ZF']
  const simpleAi = ['MLP', 'FP-LSTM', 'CNN', 'RNN']
  const sota = ['DQN baseline', 'PPO baseline', 'SAC baseline', 'DDPG baseline']
  if (traditional.includes(name)) return 'traditional'
  if (simpleAi.includes(name)) return 'simple_ai'
  if (sota.includes(name)) return 'sota'
  return 'sota' // default to sota for unknown
}

function normalizeAblations(raw: unknown): Ablation[] {
  if (!Array.isArray(raw)) return []
  return raw.map((a) => {
    if (typeof a === 'string') {
      return { name: a, impact: 0 }
    }
    return a as Ablation
  })
}

function ExperimentDetail({ exp, onUpdate }: { exp: Experiment; onUpdate: (e: Experiment) => void }) {
  const api = useApi()
  const config = JSON.parse(exp.config)
  const metrics = JSON.parse(exp.metrics)
  const baselines = useMemo(() => normalizeBaselines(JSON.parse(exp.baselines)), [exp.baselines])
  const ablations = useMemo(() => normalizeAblations(JSON.parse(exp.ablations)), [exp.ablations])
  const [notes, setNotes] = useState(exp.notes)
  const [editingNotes, setEditingNotes] = useState(false)

  const saveConfig = async (newConfig: Record<string, unknown>) => {
    const updated = { ...exp, config: JSON.stringify(newConfig) }
    try {
      await api.put(`/api/experiments/${exp.id}`, { config: updated.config })
      onUpdate(updated)
      toast.success('配置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const saveMetrics = async (newMetrics: Record<string, unknown>) => {
    const updated = { ...exp, metrics: JSON.stringify(newMetrics) }
    try {
      await api.put(`/api/experiments/${exp.id}`, { metrics: updated.metrics })
      onUpdate(updated)
      toast.success('指标已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const updateBaseline = async (level: string, name: string, checked: boolean) => {
    const existing = baselines.find((b) => b.level === level && b.name === name)
    let newBaselines: Baseline[]
    if (checked && !existing) {
      newBaselines = [...baselines, { level, name, status: 'pending' }]
    } else if (!checked && existing) {
      newBaselines = baselines.filter((b) => !(b.level === level && b.name === name))
    } else {
      return
    }
    const updated = { ...exp, baselines: JSON.stringify(newBaselines) }
    try {
      await api.put(`/api/experiments/${exp.id}`, { baselines: updated.baselines })
      onUpdate(updated)
    } catch {
      toast.error('更新失败')
    }
  }

  const updateBaselineStatus = async (level: string, name: string, status: string) => {
    const newBaselines = baselines.map((b) =>
      b.level === level && b.name === name ? { ...b, status } : b
    )
    const updated = { ...exp, baselines: JSON.stringify(newBaselines) }
    try {
      await api.put(`/api/experiments/${exp.id}`, { baselines: updated.baselines })
      onUpdate(updated)
    } catch {
      toast.error('更新失败')
    }
  }

  const addAblation = async () => {
    const name = prompt('消融组件名称：')
    if (!name) return
    const newAblations: Ablation[] = [...ablations, { name, impact: 0 }]
    const updated = { ...exp, ablations: JSON.stringify(newAblations) }
    try {
      await api.put(`/api/experiments/${exp.id}`, { ablations: updated.ablations })
      onUpdate(updated)
    } catch {
      toast.error('添加失败')
    }
  }

  const removeAblation = async (name: string) => {
    const newAblations = ablations.filter((a) => a.name !== name)
    const updated = { ...exp, ablations: JSON.stringify(newAblations) }
    try {
      await api.put(`/api/experiments/${exp.id}`, { ablations: updated.ablations })
      onUpdate(updated)
    } catch {
      toast.error('删除失败')
    }
  }

  const saveNotes = async () => {
    try {
      await api.put(`/api/experiments/${exp.id}`, { notes })
      onUpdate({ ...exp, notes })
      setEditingNotes(false)
      toast.success('备注已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const baselineLevels = [
    { level: 'traditional', name: '传统方法', defaults: ['WMMSE', 'MMSE', 'FP'] },
    { level: 'simple_ai', name: '简单AI基线', defaults: ['MLP', 'FP-LSTM'] },
    { level: 'sota', name: 'SOTA方法', defaults: ['DQN baseline', 'PPO baseline'] },
  ]

  return (
    <div className="space-y-3">
      <Card>
        <PanelHeader
          title={<span className="font-serif text-base">{exp.name}</span>}
          description={exp.topic || undefined}
        />
        <CardContent>
          {/* 与总览统计格同一形式：gap-px 细线分格 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-sm border border-border bg-border">
            <Stat label="模型" value={config.model || '-'} />
            <Stat label="学习率" value={config.lr ?? '-'} />
            <Stat label="Batch Size" value={config.batch_size ?? '-'} />
            <Stat label="Gamma" value={config.gamma ?? '-'} />
            <Stat label="Hidden Dim" value={config.hidden_dim ?? '-'} />
            <Stat label="Seed" value={exp.seed} />
            <Stat label="基线数" value={baselines.length} />
            <Stat label="消融数" value={ablations.length} />
          </div>
        </CardContent>
      </Card>

      {/* Hyperparameters */}
      <Card>
        <PanelHeader icon={Cpu} eyebrow="方法论 §3.3.2 超参数统一管理" title="超参数" />
        <CardContent className="space-y-2">
          {Object.entries(config).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <Label htmlFor={`exp-cfg-${k}`} className="text-xs font-mono w-32 shrink-0">{k}</Label>
              <Input
                id={`exp-cfg-${k}`}
                defaultValue={String(v)}
                className="tabular h-8 text-xs font-mono flex-1"
                onBlur={(e) => {
                  const newVal = typeof v === 'number' ? Number(e.target.value) : e.target.value
                  if (newVal !== v) saveConfig({ ...config, [k]: newVal })
                }}
              />
            </div>
          ))}
          <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => {
            const k = prompt('参数名：')
            if (!k) return
            const v = prompt('参数值：')
            if (v === null) return
            saveConfig({ ...config, [k]: typeof v === 'string' && !isNaN(Number(v)) ? Number(v) : v })
          }}>
            <Plus className="h-3 w-3 mr-1" aria-hidden="true" /> 新增参数
          </Button>
        </CardContent>
      </Card>

      {/* Baselines checklist */}
      <Card>
        <PanelHeader icon={CheckCircle2} eyebrow="方法论 §3.1.1 基线三层对比" title="基线完整性检查" />
        <CardContent className="space-y-3">
          {baselineLevels.map((lv) => {
            const defaults = lv.defaults
            const custom = baselines.filter((b) => b.level === lv.level && !defaults.includes(b.name))
            const allItems = [...defaults, ...custom.map((c) => c.name)]
            const checked = allItems.filter((n: string) => baselines.find((b) => b.level === lv.level && b.name === n))
            const isRequired = BASELINE_LEVELS.find((b) => b.level === lv.level)?.required
            return (
              <div key={lv.level} className="list-row p-2.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-medium">{lv.name}</h3>
                    {isRequired && <Badge variant="outline" className="rounded-sm text-[11px] font-normal border-primary/40 text-primary">必须</Badge>}
                  </div>
                  <Badge variant="outline" className="tabular rounded-sm text-[11px] font-normal">{checked.length}/{allItems.length}</Badge>
                </div>
                <div className="space-y-1">
                  {allItems.map((name: string) => {
                    const b = baselines.find((bb) => bb.level === lv.level && bb.name === name)
                    const isChecked = !!b
                    return (
                      <div key={name} className="flex items-center gap-2 text-xs">
                        {/* 原先复选框与文字没有关联，点文字不会勾选 ⇒ 用 label 包起来（行为不变，只是可点区域变大） */}
                        <label className="flex flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => updateBaseline(lv.level, name, e.target.checked)}
                            className="accent-primary"
                          />
                          <span className={cn('flex-1', !isChecked && 'text-muted-foreground line-through')}>{name}</span>
                        </label>
                        {isChecked && b && (
                          <Select value={b.status || 'pending'} onValueChange={(v) => updateBaselineStatus(lv.level, name, v)}>
                            <SelectTrigger className="h-6 w-[88px] text-[11px]" aria-label={`${name} 复现状态`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">待复现</SelectItem>
                              <SelectItem value="running">复现中</SelectItem>
                              <SelectItem value="done">已复现</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )
                  })}
                </div>
                <Button size="sm" variant="ghost" className="h-7 mt-1 text-[12px]" aria-label={`添加基线到 ${lv.name}`} onClick={() => {
                  const name = prompt(`添加到「${lv.name}」：`)
                  if (name) updateBaseline(lv.level, name, true)
                }}>
                  <Plus className="h-3 w-3 mr-0.5" aria-hidden="true" /> 添加
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Ablation */}
      <Card>
        <PanelHeader
          icon={Beaker}
          eyebrow="方法论 §3.1.3 消融实验设计模板"
          title="消融实验"
          action={
            <Button size="sm" variant="outline" onClick={addAblation}>
              <Plus className="h-3 w-3 mr-1" aria-hidden="true" /> 添加组件
            </Button>
          }
        />
        <CardContent>
          {ablations.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">尚无消融组件</div>
          ) : (
            <div className="space-y-2">
              {ablations.map((a) => (
                <div key={a.name} className="list-row flex items-center gap-2 p-2">
                  <span className="text-xs flex-1">{a.name}</span>
                  <Input
                    type="number"
                    defaultValue={a.impact || 0}
                    className="tabular h-7 w-20 text-xs"
                    aria-label={`${a.name} 性能下降百分比`}
                    placeholder="性能下降%"
                    onBlur={async (e) => {
                      const newAblations = ablations.map((x) => x.name === a.name ? { ...x, impact: Number(e.target.value) } : x)
                      const updated = { ...exp, ablations: JSON.stringify(newAblations) }
                      try {
                        await api.put(`/api/experiments/${exp.id}`, { ablations: updated.ablations })
                        onUpdate(updated)
                      } catch {
                        toast.error('保存失败')
                      }
                    }}
                  />
                  <span className="text-[11px] text-muted-foreground" aria-hidden="true">%</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    aria-label={`删除消融组件 ${a.name}`}
                    onClick={() => removeAblation(a.name)}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metrics */}
      <Card>
        <PanelHeader icon={TrendingUp} eyebrow="方法论 §3.4.1 性能指标" title="实验指标" />
        <CardContent className="space-y-2">
          {Object.keys(metrics).length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">尚无指标数据</div>
          ) : (
            Object.entries(metrics).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <Label htmlFor={`exp-metric-${k}`} className="text-xs font-mono w-40 shrink-0">{k}</Label>
                <Input
                  id={`exp-metric-${k}`}
                  defaultValue={String(v)}
                  className="tabular h-8 text-xs font-mono flex-1"
                  onBlur={(e) => {
                    const newVal = typeof v === 'number' ? Number(e.target.value) : e.target.value
                    if (newVal !== v) saveMetrics({ ...metrics, [k]: newVal })
                  }}
                />
                <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10" aria-label={`删除指标 ${k}`} onClick={async () => {
                  const newM = { ...metrics }
                  delete newM[k]
                  const updated = { ...exp, metrics: JSON.stringify(newM) }
                  try { await api.put(`/api/experiments/${exp.id}`, { metrics: updated.metrics }); onUpdate(updated) } catch {}
                }}>
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            ))
          )}
          <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => {
            const k = prompt('指标名 (如 avg_throughput):')
            if (!k) return
            const v = prompt('指标值:')
            if (v === null) return
            saveMetrics({ ...metrics, [k]: typeof v === 'string' && !isNaN(Number(v)) ? Number(v) : v })
          }}>
            <Plus className="h-3 w-3 mr-1" aria-hidden="true" /> 新增指标
          </Button>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <PanelHeader
          title="实验备注"
          action={
            <div className="flex gap-1">
              {editingNotes ? (
                <>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setNotes(exp.notes); setEditingNotes(false) }}>取消</Button>
                  <Button size="sm" className="h-7 text-xs" onClick={saveNotes}>保存</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingNotes(true)}>编辑</Button>
              )}
            </div>
          }
        />
        <CardContent>
          {editingNotes ? (
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="实验备注" className="min-h-[120px] text-xs" />
          ) : (
            <div className="rounded-sm border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap min-h-[40px]">{exp.notes || '暂无备注'}</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card p-2.5 text-center">
      <div className="tabular font-mono text-sm font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

// ============ 可视化模板 ============
function VisualizationTemplates() {
  // Demo data for visualization templates (result_visualization.py)
  const convergenceData = useMemo(() => {
    return Array.from({ length: 50 }, (_, i) => {
      const noise = () => (Math.random() - 0.5) * 2
      return {
        episode: i + 1,
        WMMSE: 30 + 5 * Math.log10(i + 1) + noise() * 0.5,
        DQN: 30 + 12 * (1 - Math.exp(-i / 20)) + noise(),
        PPO: 30 + 14 * (1 - Math.exp(-i / 15)) + noise() * 0.8,
        Ours: 30 + 18 * (1 - Math.exp(-i / 10)) + noise() * 0.5,
      }
    })
  }, [])

  const barData = [
    { method: 'WMMSE', throughput: 30, fairness: 0.80 },
    { method: 'MLP', throughput: 35, fairness: 0.85 },
    { method: 'DQN', throughput: 42, fairness: 0.88 },
    { method: 'PPO', throughput: 45, fairness: 0.90 },
    { method: 'Ours', throughput: 52, fairness: 0.95 },
  ]

  const radarData = [
    { metric: '吞吐量', WMMSE: 6, Ours: 9 },
    { metric: '公平性', WMMSE: 7, Ours: 9 },
    { metric: '收敛速度', WMMSE: 8, Ours: 9 },
    { metric: '低SNR性能', WMMSE: 5, Ours: 8 },
    { metric: '鲁棒性', WMMSE: 6, Ours: 9 },
    { metric: '复杂度', WMMSE: 9, Ours: 6 },
  ]

  return (
    <div className="space-y-3">
      <MethodNote>
        📊 <strong>结果可视化模板</strong>
        （方法论 §3.4.2 result_visualization.py）—— 提供三种常用图表模板，可直接复用
      </MethodNote>

      {/* 图表色一律走 --chart-1..5 令牌；基线用中性灰（--muted-foreground），「Ours」用主强调色加粗。
          ⚠️ 原先写的 `hsl(var(--border))` 是坏的：本项目令牌是 oklch 值，套 hsl() 会得到无效颜色 */}
      {/* Convergence curve */}
      <Card>
        <PanelHeader title="① 训练收敛曲线" description="展示各方法在训练过程中的奖励变化，含标准差带" />
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={convergenceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="episode" label={{ value: 'Episode', position: 'insideBottom', offset: -5, fontSize: 11 }} fontSize={11} />
              <YAxis label={{ value: 'Avg Reward', angle: -90, position: 'insideLeft', fontSize: 11 }} fontSize={11} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="WMMSE" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="DQN" stroke="var(--chart-2)" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="PPO" stroke="var(--chart-3)" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="Ours" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Bar comparison */}
      <Card>
        <PanelHeader title="② 性能对比柱状图" description="多方法在多个指标上的对比" />
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="method" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="throughput" fill="var(--chart-1)" name="Throughput (bps/Hz)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="fairness" fill="var(--chart-2)" name="Fairness" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Radar comparison */}
      <Card>
        <PanelHeader title="③ 多维雷达图对比" description="展示方法在多个维度上的综合表现" />
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="metric" fontSize={11} />
              <PolarRadiusAxis domain={[0, 10]} fontSize={11} />
              <Radar name="WMMSE" dataKey="WMMSE" stroke="var(--muted-foreground)" fill="var(--muted-foreground)" fillOpacity={0.2} />
              <Radar name="Ours" dataKey="Ours" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.35} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
            </RadarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

// ============ 性能指标参考 ============
function MetricsReference() {
  return (
    <div className="space-y-3">
      <MethodNote>
        📐 <strong>通信 AI 常用性能指标</strong>
        （方法论 §3.4.1）—— 7 大常用指标速查
      </MethodNote>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {METRICS.map((m) => (
          <div key={m.name} className="list-row p-3">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-semibold">{m.name}</h3>
                <div className="text-[12px] text-muted-foreground">{m.fullName}</div>
              </div>
              <Badge variant="outline" className="rounded-sm text-[11px] font-normal">{m.scene}</Badge>
            </div>
            <div className="rounded-sm border border-border bg-muted/50 p-2 font-mono text-[12px] mt-2 overflow-x-auto">{m.formula}</div>
          </div>
        ))}
      </div>

      <Card>
        <PanelHeader eyebrow="方法论 §3.4.3" title="结果分析检查清单" />
        <CardContent className="space-y-2 text-xs">
          {[
            '你的方法在所有实验条件下都比基线好？如果某个条件下降，解释原因',
            '性能提升的代价是什么？（计算复杂度增加？收敛变慢？参数更多？）',
            '消融实验中哪个组件最关键？核心创新点是否被验证？',
            '实验结果是否稳定？多次随机种子下的方差大小',
            '是否存在过拟合？Train/Val/Test 三组数据上的表现差异',
            '结果是否可复现？固定种子后能否得到相同结果？',
          ].map((q, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="tabular flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-accent font-mono text-accent-foreground text-[11px] font-semibold mt-0.5" aria-hidden="true">
                {i + 1}
              </div>
              <span className="leading-relaxed text-muted-foreground">{q}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
