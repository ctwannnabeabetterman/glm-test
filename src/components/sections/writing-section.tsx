'use client'

import { useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { SectionHeader } from './papers-section'
import { AIAbstractGenerator } from '@/components/ai-abstract-generator'
import { AIReviewGenerator } from '@/components/ai-review-generator'
import { PAPER_SECTIONS, ACADEMIC_PHRASES, REVIEW_RESPONSE_PHRASES, SUBMISSION_CHECKLIST } from '@/lib/methodology-data'
import {
  PenLine,
  CheckCircle2,
  XCircle,
  Copy,
  FileText,
  ListChecks,
  Quote,
  MessageSquare,
  AlertTriangle,
  Sparkles,
  BookMarked,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function WritingSection() {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="论文写作"
        desc="结构检查 · 学术句式 · 审稿回复 · 投稿清单"
        icon={PenLine}
      />

      <Tabs defaultValue="structure">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="structure">
            <ListChecks className="h-3.5 w-3.5 mr-1.5" />
            结构检查
          </TabsTrigger>
          <TabsTrigger value="abstract">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Abstract 生成
          </TabsTrigger>
          <TabsTrigger value="phrases">
            <Quote className="h-3.5 w-3.5 mr-1.5" />
            学术句式
          </TabsTrigger>
          <TabsTrigger value="review">
            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
            审稿回复
          </TabsTrigger>
          <TabsTrigger value="checklist">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            投稿清单
          </TabsTrigger>
        </TabsList>

        <TabsContent value="structure"><StructureChecker /></TabsContent>
        <TabsContent value="abstract">
          <div className="space-y-3">
            <AIAbstractGenerator />
            <AbstractGenerator />
          </div>
        </TabsContent>
        <TabsContent value="review">
          <div className="space-y-3">
            <AIReviewGenerator />
            <ReviewResponse />
          </div>
        </TabsContent>
        <TabsContent value="phrases"><AcademicPhrases /></TabsContent>
        <TabsContent value="checklist"><SubmissionChecklistView /></TabsContent>
      </Tabs>
    </div>
  )
}

// ============ Structure Checker ============
function StructureChecker() {
  const [checks, setChecks] = useState<Record<string, boolean[]>>(() => {
    const init: Record<string, boolean[]> = {}
    Object.entries(PAPER_SECTIONS).forEach(([section, items]) => {
      init[section] = items.map(() => false)
    })
    return init
  })

  const toggle = (section: string, idx: number) => {
    setChecks((prev) => ({
      ...prev,
      [section]: prev[section].map((v, i) => i === idx ? !v : v),
    }))
  }

  const stats = Object.entries(checks).map(([section, arr]) => ({
    section,
    done: arr.filter(Boolean).length,
    total: arr.length,
  }))
  const totalDone = stats.reduce((s, x) => s + x.done, 0)
  const totalAll = stats.reduce((s, x) => s + x.total, 0)
  const pct = totalAll > 0 ? (totalDone / totalAll) * 100 : 0
  const status = pct >= 80 ? '✓ 可提交' : pct >= 60 ? '△ 需要补充' : '✗ 大量缺失'
  const statusColor = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-3">
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          📋 <strong className="text-blue-700 dark:text-blue-400">论文结构完整性检查</strong>
          （方法论 §5.1.3 paper_structure_check.py）—— 7 大章节共 30+ 检查项
        </CardContent>
      </Card>

      {/* Overall progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-2xl font-bold gradient-text">{pct.toFixed(0)}%</div>
              <div className="text-xs text-muted-foreground">总完成度 ({totalDone}/{totalAll})</div>
            </div>
            <div className={cn('text-lg font-bold', statusColor)}>{status}</div>
          </div>
          <Progress value={pct} className="h-2.5" />
        </CardContent>
      </Card>

      {/* Section by section */}
      <div className="space-y-2">
        {Object.entries(PAPER_SECTIONS).map(([section, items]) => {
          const sectionStats = stats.find((s) => s.section === section)!
          const sectionPct = (sectionStats.done / sectionStats.total) * 100
          return (
            <Card key={section}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{section}</CardTitle>
                  <Badge variant="outline" className={cn('text-xs', sectionPct === 100 ? 'bg-emerald-500/15 text-emerald-600' : sectionPct > 0 ? 'bg-amber-500/15 text-amber-600' : '')}>
                    {sectionStats.done}/{sectionStats.total}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-1">
                {items.map((item, i) => {
                  const checked = checks[section][i]
                  return (
                    <button
                      key={i}
                      onClick={() => toggle(section, i)}
                      className="flex items-start gap-2 w-full text-left rounded-md p-1.5 hover:bg-muted/50 transition-colors"
                    >
                      {checked ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <div className="h-4 w-4 shrink-0 mt-0.5 rounded-full border-2 border-muted-foreground/30" />
                      )}
                      <span className={cn('text-xs', checked ? 'text-muted-foreground line-through' : 'text-foreground')}>{item}</span>
                    </button>
                  )
                })}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ============ Abstract Generator ============
function AbstractGenerator() {
  const [sentences, setSentences] = useState({
    background: '',
    gap: '',
    method: '',
    results: '',
  })

  const examples = {
    background: 'Deep reinforcement learning (DRL) has emerged as a promising approach for resource allocation in wireless networks.',
    gap: 'However, existing DRL-based methods suffer from slow convergence and poor performance under dynamic channel conditions.',
    method: 'In this paper, we propose a novel multi-agent DRL framework with attention mechanism that enables adaptive power control in multi-cell interference channels.',
    results: 'Simulation results show that our method achieves 25% higher throughput and 40% faster convergence compared to state-of-the-art baselines.',
  }

  const abstract = `${sentences.background} ${sentences.gap} ${sentences.method} ${sentences.results}`.trim()
  const wordCount = abstract ? abstract.split(/\s+/).length : 0

  return (
    <div className="space-y-3">
      <Card className="bg-emerald-500/5 border-emerald-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          📝 <strong className="text-emerald-700 dark:text-emerald-400">Abstract 四句话模板</strong>
          （方法论 §5.1.2）—— 严格遵循 背景句 + 问题句 + 方法句 + 结果句
        </CardContent>
      </Card>

      <div className="space-y-3">
        <SentenceEditor
          label="① 背景与问题"
          placeholder="背景句：阐述领域重要性"
          value={sentences.background}
          example={examples.background}
          onChange={(v) => setSentences({ ...sentences, background: v })}
          color="bg-blue-500/10 border-blue-500/30"
        />
        <SentenceEditor
          label="② 现有方法的不足"
          placeholder="问题句：However, ..."
          value={sentences.gap}
          example={examples.gap}
          onChange={(v) => setSentences({ ...sentences, gap: v })}
          color="bg-amber-500/10 border-amber-500/30"
        />
        <SentenceEditor
          label="③ 本文方法"
          placeholder="方法句：In this paper, we propose ..."
          value={sentences.method}
          example={examples.method}
          onChange={(v) => setSentences({ ...sentences, method: v })}
          color="bg-emerald-500/10 border-emerald-500/30"
        />
        <SentenceEditor
          label="④ 实验结果"
          placeholder="结果句：Simulation results show ..."
          value={sentences.results}
          example={examples.results}
          onChange={(v) => setSentences({ ...sentences, results: v })}
          color="bg-purple-500/10 border-purple-500/30"
        />
      </div>

      {/* Preview */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">生成预览</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn('text-[10px]', wordCount > 200 ? 'text-amber-600' : 'text-emerald-600')}>
                {wordCount} words
              </Badge>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { navigator.clipboard.writeText(abstract); toast.success('已复制') }} disabled={!abstract}>
                <Copy className="h-3 w-3 mr-1" /> 复制
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs">IEEE 会议论文摘要建议 150-250 词</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-muted/50 p-3 text-sm leading-relaxed min-h-[80px]">
            {abstract || <span className="text-muted-foreground text-xs">在上方填写四句话，自动生成摘要...</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SentenceEditor({ label, placeholder, value, example, onChange, color }: {
  label: string
  placeholder: string
  value: string
  example: string
  onChange: (v: string) => void
  color: string
}) {
  return (
    <Card className={cn('border', color)}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-medium">{label}</Label>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { onChange(example); toast.success('已填入示例') }}>
            <Sparkles className="h-2.5 w-2.5 mr-0.5" /> 示例
          </Button>
        </div>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-xs min-h-[60px]"
        />
      </CardContent>
    </Card>
  )
}

// ============ Academic Phrases ============
function AcademicPhrases() {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(text)
    toast.success('已复制')
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="space-y-3">
      <Card className="bg-purple-500/5 border-purple-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          💬 <strong className="text-purple-700 dark:text-purple-400">学术英语高频句式</strong>
          （方法论 §5.3.1）—— 直接复制使用，提升写作效率
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(ACADEMIC_PHRASES).map(([category, phrases]) => (
          <Card key={category}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookMarked className="h-3.5 w-3.5 text-primary" />
                {category}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {Array.isArray(phrases) ? (
                phrases.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => copy(p)}
                    className="block w-full text-left rounded-md p-2 text-xs hover:bg-muted/60 transition-colors group"
                  >
                    <div className="flex items-start gap-2">
                      <Quote className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                      <span className="flex-1">{p}</span>
                      <Copy className={cn('h-3 w-3 shrink-0 mt-0.5 transition-opacity', copied === p ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-50')} />
                    </div>
                  </button>
                ))
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(phrases as string[]).map((p, i) => (
                    <button
                      key={i}
                      onClick={() => copy(p)}
                      className="rounded-md bg-muted/50 px-2 py-1 text-[10px] hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ============ Review Response ============
function ReviewResponse() {
  const [copied, setCopied] = useState<string | null>(null)
  const [reviewComment, setReviewComment] = useState('The paper lacks comparison with the state-of-the-art method proposed by Zhang et al. (2022).')
  const [response, setResponse] = useState('')

  const generateResponse = (template: string) => {
    const generated = `${template} Following this suggestion, we have added a comparison with Zhang et al.'s method, and the results are shown in the new Fig. 4. As shown, our method outperforms Zhang et al.'s by 15% in terms of throughput while maintaining comparable complexity.`
    setResponse(generated)
    toast.success('已生成回复草稿')
  }

  return (
    <div className="space-y-3">
      <Card className="bg-amber-500/5 border-amber-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          📧 <strong className="text-amber-700 dark:text-amber-400">审稿回复模板</strong>
          （方法论 §6.3）—— Point-by-point 回复 + 常用句式
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">审稿意见</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            className="text-xs min-h-[60px]"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">回复草稿</CardTitle>
          <CardDescription className="text-xs">点击下方句式快速生成</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            className="text-xs min-h-[120px]"
            placeholder="生成的回复将显示在此..."
          />
          {response && (
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => { navigator.clipboard.writeText(response); toast.success('已复制') }}>
              <Copy className="h-3 w-3 mr-1" /> 复制回复
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Phrase templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(REVIEW_RESPONSE_PHRASES).map(([category, phrases]) => (
          <Card key={category}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{category}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {phrases.map((p, i) => (
                <button
                  key={i}
                  onClick={() => generateResponse(p)}
                  className="block w-full text-left rounded-md p-2 text-xs hover:bg-muted/60 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="flex-1">{p}</span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-red-500/5 border-red-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1 text-red-600" />
          <strong>Major Revision ≠ 拒稿</strong>（方法论 §6.3.1）！Major = 还有机会，认真回复录取率 &gt;80%。关键是有没有增加实验/实质性修改。
        </CardContent>
      </Card>
    </div>
  )
}

// ============ Submission Checklist ============
function SubmissionChecklistView() {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const toggle = (item: string) => setChecked((prev) => ({ ...prev, [item]: !prev[item] }))

  const totalItems = SUBMISSION_CHECKLIST.reduce((s, c) => s + c.items.length, 0)
  const doneItems = Object.values(checked).filter(Boolean).length
  const pct = (doneItems / totalItems) * 100
  const ready = doneItems === totalItems

  return (
    <div className="space-y-3">
      <Card className="bg-pink-500/5 border-pink-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          ✅ <strong className="text-pink-700 dark:text-pink-400">投稿检查清单</strong>
          （方法论 §6.2.1 submission_checklist.py）—— IEEE 会议/期刊投稿前必检
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-2xl font-bold gradient-text">{pct.toFixed(0)}%</div>
              <div className="text-xs text-muted-foreground">已检查 ({doneItems}/{totalItems})</div>
            </div>
            <Badge variant={ready ? 'default' : 'secondary'} className={ready ? 'bg-emerald-500 text-white' : 'bg-amber-500/15 text-amber-600'}>
              {ready ? '✓ 可提交' : '✗ 未完成'}
            </Badge>
          </div>
          <Progress value={pct} className="h-2.5" />
        </CardContent>
      </Card>

      <div className="space-y-3">
        {SUBMISSION_CHECKLIST.map((cat) => (
          <Card key={cat.category}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{cat.category}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {cat.items.map((item) => {
                const isChecked = !!checked[item]
                return (
                  <button
                    key={item}
                    onClick={() => toggle(item)}
                    className="flex items-start gap-2 w-full text-left rounded-md p-1.5 hover:bg-muted/50 transition-colors"
                  >
                    {isChecked ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <div className="h-4 w-4 shrink-0 mt-0.5 rounded-full border-2 border-muted-foreground/30" />
                    )}
                    <span className={cn('text-xs', isChecked && 'text-muted-foreground line-through')}>{item}</span>
                  </button>
                )
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
