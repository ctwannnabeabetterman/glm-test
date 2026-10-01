'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { SectionHeader, PanelHeader, MethodNote } from '@/components/section-header'
import { WritingWorkbench } from '@/components/writing-workbench'
import { AIAbstractGenerator } from '@/components/ai-abstract-generator'
import { AIReviewGenerator } from '@/components/ai-review-generator'
import { AIDirectionExplorer } from '@/components/ai-direction-explorer'
import { PAPER_SECTIONS, ACADEMIC_PHRASES, REVIEW_RESPONSE_PHRASES, SUBMISSION_CHECKLIST } from '@/lib/methodology-data'
import {
  PenLine,
  CheckCircle2,
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
        desc="写作工作台（[@引用] 自动编号 · IEEE / GB-T 7714 著录）· 阅读→综述草稿 · 结构检查 · 学术句式 · 审稿回复 · 投稿清单"
        icon={PenLine}
      />

      <Tabs defaultValue="workbench">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="workbench">
            <BookMarked className="h-3.5 w-3.5 mr-1.5" />
            写作工作台
          </TabsTrigger>
          <TabsTrigger value="structure">
            <ListChecks className="h-3.5 w-3.5 mr-1.5" />
            结构检查
          </TabsTrigger>
          <TabsTrigger value="abstract">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Abstract 生成
          </TabsTrigger>
          <TabsTrigger value="review-draft">
            <BookMarked className="h-3.5 w-3.5 mr-1.5" />
            综述草稿
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

        <TabsContent value="workbench"><WritingWorkbench /></TabsContent>
        <TabsContent value="structure"><StructureChecker /></TabsContent>
        <TabsContent value="abstract">
          <div className="space-y-3">
            <AIDirectionExplorer />
            <AIAbstractGenerator />
            <AbstractGenerator />
          </div>
        </TabsContent>
        <TabsContent value="review-draft">
          <AIReviewGenerator />
        </TabsContent>
        <TabsContent value="review">
          <ReviewResponse />
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
  /* 可提交 = 强调色；需补充 = 墨色；大量缺失 = destructive（只有这一档是警示） */
  const statusColor = pct >= 80 ? 'text-primary' : pct >= 60 ? 'text-foreground' : 'text-destructive'

  return (
    <div className="space-y-3">
      <MethodNote>
        📋 <strong>论文结构完整性检查</strong>
        （方法论 §5.1.3 paper_structure_check.py）—— 7 大章节共 30+ 检查项
      </MethodNote>

      {/* Overall progress（原 gradient-text 类未定义，去掉） */}
      <Card className="py-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="tabular font-mono text-2xl font-semibold tracking-tight">{pct.toFixed(0)}%</div>
              <div className="tabular text-xs text-muted-foreground">总完成度 ({totalDone}/{totalAll})</div>
            </div>
            <div className={cn('text-lg font-semibold', statusColor)} aria-live="polite">{status}</div>
          </div>
          <Progress value={pct} className="h-2" aria-label="论文结构完成度" />
        </CardContent>
      </Card>

      {/* Section by section */}
      <div className="space-y-2">
        {Object.entries(PAPER_SECTIONS).map(([section, items]) => {
          const sectionStats = stats.find((s) => s.section === section)!
          const sectionPct = (sectionStats.done / sectionStats.total) * 100
          return (
            <Card key={section}>
              <PanelHeader
                as="h3"
                title={section}
                action={
                  <Badge
                    variant="outline"
                    className={cn(
                      'tabular rounded-sm text-xs font-normal',
                      sectionPct === 100 ? 'border-primary/30 bg-primary/10 text-primary' : sectionPct > 0 ? 'bg-accent text-accent-foreground' : '',
                    )}
                  >
                    {sectionStats.done}/{sectionStats.total}
                  </Badge>
                }
              />
              <CardContent className="pt-0 space-y-1">
                {items.map((item, i) => {
                  const checked = checks[section][i]
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggle(section, i)}
                      aria-pressed={checked}
                      className="flex items-start gap-2 w-full text-left rounded-sm p-1.5 hover:bg-muted/50 transition-colors"
                    >
                      {checked ? (
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <span className="h-4 w-4 shrink-0 mt-0.5 rounded-full border-2 border-muted-foreground/30" aria-hidden="true" />
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
      <MethodNote>
        📝 <strong>Abstract 四句话模板</strong>
        （方法论 §5.1.2）—— 严格遵循 背景句 + 问题句 + 方法句 + 结果句
      </MethodNote>

      <div className="space-y-3">
        <SentenceEditor
          label="① 背景与问题"
          placeholder="背景句：阐述领域重要性"
          value={sentences.background}
          example={examples.background}
          onChange={(v) => setSentences({ ...sentences, background: v })}
          color="border-l-primary"
        />
        <SentenceEditor
          label="② 现有方法的不足"
          placeholder="问题句：However, ..."
          value={sentences.gap}
          example={examples.gap}
          onChange={(v) => setSentences({ ...sentences, gap: v })}
          color="border-l-primary/70"
        />
        <SentenceEditor
          label="③ 本文方法"
          placeholder="方法句：In this paper, we propose ..."
          value={sentences.method}
          example={examples.method}
          onChange={(v) => setSentences({ ...sentences, method: v })}
          color="border-l-primary/45"
        />
        <SentenceEditor
          label="④ 实验结果"
          placeholder="结果句：Simulation results show ..."
          value={sentences.results}
          example={examples.results}
          onChange={(v) => setSentences({ ...sentences, results: v })}
          color="border-l-primary/25"
        />
      </div>

      {/* Preview */}
      <Card>
        <PanelHeader
          title="生成预览"
          description="IEEE 会议论文摘要建议 150-250 词"
          action={
            <div className="flex items-center gap-2">
              {/* 超长是需要处理的提示 ⇒ destructive；否则强调色 */}
              <Badge variant="outline" className={cn('tabular rounded-sm text-[11px] font-normal', wordCount > 200 ? 'border-destructive/30 text-destructive' : 'border-primary/30 text-primary')} aria-live="polite">
                {wordCount} words
              </Badge>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { navigator.clipboard.writeText(abstract); toast.success('已复制') }} disabled={!abstract}>
                <Copy className="h-3 w-3 mr-1" aria-hidden="true" /> 复制
              </Button>
            </div>
          }
        />
        <CardContent>
          <div className="prose-research rounded-sm border border-border bg-muted/30 p-3 min-h-[80px]">
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
  /* color 现在只决定左侧强调线的深浅（四句话按顺序由深到浅），不再是四种色块 */
  return (
    <Card className={cn('border-l-2 py-0', color)}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-medium">{label}</Label>
          <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => { onChange(example); toast.success('已填入示例') }}>
            <Sparkles className="h-3 w-3 mr-0.5" aria-hidden="true" /> 示例
          </Button>
        </div>
        <Textarea
          aria-label={label}
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
      <MethodNote>
        💬 <strong>学术英语高频句式</strong>
        （方法论 §5.3.1）—— 直接复制使用，提升写作效率
      </MethodNote>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(ACADEMIC_PHRASES).map(([category, phrases]) => (
          <Card key={category}>
            <PanelHeader icon={BookMarked} title={category} />
            <CardContent className="pt-0 space-y-1">
              {Array.isArray(phrases) ? (
                phrases.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => copy(p)}
                    aria-label={`复制句式：${p}`}
                    className="block w-full text-left rounded-sm p-2 text-xs leading-relaxed hover:bg-muted/60 transition-colors group"
                  >
                    <span className="flex items-start gap-2">
                      <Quote className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                      <span className="flex-1 font-serif">{p}</span>
                      <Copy className={cn('h-3 w-3 shrink-0 mt-0.5 transition-opacity', copied === p ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-50 group-focus-visible:opacity-50')} aria-hidden="true" />
                    </span>
                  </button>
                ))
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(phrases as string[]).map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => copy(p)}
                      className="rounded-sm border border-border bg-muted/50 px-2 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground transition-colors"
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
      <MethodNote>
        📧 <strong>审稿回复模板</strong>
        （方法论 §6.3）—— Point-by-point 回复 + 常用句式
      </MethodNote>

      <Card>
        <PanelHeader title="审稿意见" />
        <CardContent>
          <Textarea
            aria-label="审稿意见"
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            className="text-xs min-h-[60px]"
          />
        </CardContent>
      </Card>

      <Card>
        <PanelHeader title="回复草稿" description="点击下方句式快速生成" />
        <CardContent>
          <Textarea
            aria-label="回复草稿"
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            className="text-xs min-h-[120px]"
            placeholder="生成的回复将显示在此..."
          />
          {response && (
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => { navigator.clipboard.writeText(response); toast.success('已复制') }}>
              <Copy className="h-3 w-3 mr-1" aria-hidden="true" /> 复制回复
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Phrase templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(REVIEW_RESPONSE_PHRASES).map(([category, phrases]) => (
          <Card key={category}>
            <PanelHeader as="h3" title={category} />
            <CardContent className="pt-0 space-y-1">
              {phrases.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => generateResponse(p)}
                  className="block w-full text-left rounded-sm p-2 text-xs leading-relaxed hover:bg-muted/60 transition-colors group"
                >
                  <span className="flex items-start gap-2">
                    <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="flex-1 font-serif">{p}</span>
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 这是提醒而非错误 ⇒ 默认语气；图标用强调色 */}
      <MethodNote icon={AlertTriangle}>
        <strong>Major Revision ≠ 拒稿</strong>（方法论 §6.3.1）！Major = 还有机会，认真回复录取率 &gt;80%。关键是有没有增加实验/实质性修改。
      </MethodNote>
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
      <MethodNote>
        ✅ <strong>投稿检查清单</strong>
        （方法论 §6.2.1 submission_checklist.py）—— IEEE 会议/期刊投稿前必检
      </MethodNote>

      <Card className="py-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="tabular font-mono text-2xl font-semibold tracking-tight">{pct.toFixed(0)}%</div>
              <div className="tabular text-xs text-muted-foreground">已检查 ({doneItems}/{totalItems})</div>
            </div>
            <Badge
              variant={ready ? 'default' : 'secondary'}
              className={cn('rounded-sm', ready ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}
              aria-live="polite"
            >
              {ready ? '✓ 可提交' : '✗ 未完成'}
            </Badge>
          </div>
          <Progress value={pct} className="h-2" aria-label="投稿检查完成度" />
        </CardContent>
      </Card>

      <div className="space-y-3">
        {SUBMISSION_CHECKLIST.map((cat) => (
          <Card key={cat.category}>
            <PanelHeader as="h3" title={cat.category} />
            <CardContent className="pt-0 space-y-1">
              {cat.items.map((item) => {
                const isChecked = !!checked[item]
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggle(item)}
                    aria-pressed={isChecked}
                    className="flex items-start gap-2 w-full text-left rounded-sm p-1.5 hover:bg-muted/50 transition-colors"
                  >
                    {isChecked ? (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 mt-0.5 rounded-full border-2 border-muted-foreground/30" aria-hidden="true" />
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
