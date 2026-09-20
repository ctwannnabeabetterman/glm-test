'use client'

import { useMemo, useState } from 'react'
import { useFetch } from '@/lib/hooks'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sparkles,
  Copy,
  Loader2,
  FileText,
  Globe,
  Languages,
  Layers,
  PenLine,
  TriangleAlert,
  Quote,
} from 'lucide-react'
import { toast } from 'sonner'
import { toastAiError } from '@/lib/ai-error'
import { AiMarkdown } from '@/components/ai-markdown'

/** 「不限课题」的哨兵值 —— Radix Select 不允许空字符串作为 item value */
const ALL_TOPICS = '__all__'

/** 阅读范围：综述的取料口径，默认「仅已读」（对应「阅读 → 综述」这条工作流） */
const SCOPES = [
  { id: 'read', label: '仅已读', hint: '只用作已读完的文献 —— 你确实了解的结论' },
  { id: 'reading', label: '已读 + 在读', hint: '把正在读的也纳入，覆盖更全' },
  { id: 'all', label: '不限阅读状态', hint: '含未读文献，适合快速摸底（结论可靠性更低）' },
] as const

type ScopeId = (typeof SCOPES)[number]['id']

interface TopicOption {
  id: string
  name: string
  direction: string
  paperCount?: number
}

interface ReviewUsed {
  papers: number
  relatedPapers: number
  excludedByScope: number
  scopeLabel: string
}

interface ReviewCitations {
  total: number
  known: number
  unknown: string[]
}

interface ReviewResult {
  content: string
  used: ReviewUsed
  citations: ReviewCitations
  topicName: string | null
  scope: ScopeId
  focus: string
  language: 'zh' | 'en'
}

const FOCUS_LABEL: Record<string, string> = {
  general: '综合',
  method: '方法对比',
  gap: '研究空白',
  timeline: '时间脉络',
}

/**
 * 「阅读 → 综述草稿」面板。
 *
 * 2026-09-20 重写要点（与 `/api/ai-review` 的改动配套）：
 *  1. 顶部两个选择器决定**取料口径**：课题域 + 阅读范围。旧版取的是「全库最新 15 篇」，
 *     跟用户读过什么完全无关；
 *  2. 产出的正文里带 `[@paperId]` —— 与写作工作台的引用语法一致，
 *     所以它**能被直接用**：点「发到写作台」即插入新章节，引用自动编号、
 *     自动生成参考文献表（IEEE / GB/T 7714 任选）。
 *     没有这条通道的话，用户要自己复制 → 切页 → 选章节 → 粘到光标处。
 *  3. 显式提示模型编造的引用（unknown）：这类错误在导出前几乎不可能被发现。
 */
export function AIReviewGenerator() {
  const { data: topics } = useFetch<TopicOption[]>('/api/topics?withCounts=1')
  const sendDraftToWriting = useAppStore((s) => s.sendDraftToWriting)
  const setSection = useAppStore((s) => s.setSection)

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [topic, setTopic] = useState('')
  const [focus, setFocus] = useState('general')
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [scope, setScope] = useState<ScopeId>('read')
  // '' 表示「用户还没挑课题」，默认值由下面派生（在 effect 里同步 setState 会级联渲染）
  const [picked, setPicked] = useState('')

  const topicList = useMemo(() => topics ?? [], [topics])
  const scopeTopicId = picked || (topicList.length > 0 ? topicList[0].id : ALL_TOPICS)
  const currentTopic = topicList.find((t) => t.id === scopeTopicId) ?? null

  const generate = async () => {
    if (!topic.trim()) {
      toast.error('请输入研究课题')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          focus,
          language,
          scope,
          topicId: scopeTopicId === ALL_TOPICS ? '' : scopeTopicId,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        toastAiError(data, '生成失败')
        return
      }
      setResult({
        content: data.content,
        used: data.used,
        citations: data.citations,
        topicName: data.topicName ?? null,
        scope,
        focus,
        language,
      })
      const used = data.used as ReviewUsed | undefined
      const unknown = (data.citations?.unknown as string[] | undefined)?.length ?? 0
      toast.success(
        `综述草稿已生成（依据 ${used?.papers ?? 0} 篇论文）` +
          (unknown > 0 ? ` —— 有 ${unknown} 处引用不在范围内，请检查` : '')
      )
    } catch (e) {
      toast.error('AI 生成失败: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(label)
  }

  const sendToWorkbench = () => {
    if (!result) return
    sendDraftToWriting({
      content: result.content,
      title: `相关工作：${topic.trim() || result.topicName || 'AI 综述草稿'}`,
    })
    setSection('writing')
    toast.success('已发到写作工作台 —— 引用会自动编号，没有稿件时会等你新建')
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              阅读 → 综述草稿
            </CardTitle>
            <CardDescription className="text-xs">
              按课题域与阅读范围取料 · 正文带 [@引用] 标记，可直接插入写作工作台自动编号
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[9px] bg-primary/5">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            LLM
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 取料口径：课题域 + 阅读范围 */}
        <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            <Layers className="h-3.5 w-3.5 text-primary" />
            取料范围
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">课题域</Label>
              <Select value={scopeTopicId} onValueChange={setPicked}>
                <SelectTrigger size="sm" className="w-full text-xs mt-1">
                  <SelectValue placeholder="选择课题" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TOPICS}>不限课题（全库）</SelectItem>
                  {topicList.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.direction ? `（${t.direction}）` : ''}
                      {typeof t.paperCount === 'number' ? ` · ${t.paperCount} 篇` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">阅读范围</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as ScopeId)}>
                <SelectTrigger size="sm" className="w-full text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {SCOPES.find((s) => s.id === scope)?.hint}。
            {scopeTopicId === ALL_TOPICS
              ? '当前不限课题，课题多时文献会互相稀释，建议选一个具体课题。'
              : `只使用挂到「${currentTopic?.name ?? scopeTopicId}」的文献；未归课题的不会算进来。`}
          </p>
        </div>

        {/* Input form */}
        <div>
          <Label className="text-xs">研究课题 *</Label>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例如: RIS 辅助网络中的 DRL 资源分配"
            className="mt-1 text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">综述重点</Label>
            <Select value={focus} onValueChange={setFocus}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">综合（方法分类+Gap）</SelectItem>
                <SelectItem value="method">方法对比</SelectItem>
                <SelectItem value="gap">研究空白</SelectItem>
                <SelectItem value="timeline">时间脉络</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">输出语言</Label>
            <Select value={language} onValueChange={(v) => setLanguage(v as 'zh' | 'en')}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Generate button */}
        <Button
          onClick={generate}
          disabled={loading || !topic.trim()}
          className="w-full"
          size="sm"
        >
          {loading ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> AI 生成中（约 30 秒）...</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> 生成综述草稿</>
          )}
        </Button>

        {/* Result */}
        {result && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-primary">AI 生成结果</span>
                <Badge variant="secondary" className="text-[9px]">
                  <Languages className="h-2.5 w-2.5 mr-0.5" />
                  {result.language === 'zh' ? '中文' : 'English'}
                </Badge>
                <Badge variant="secondary" className="text-[9px]">
                  {FOCUS_LABEL[result.focus] ?? result.focus}
                </Badge>
                <Badge variant="secondary" className="text-[9px]">
                  依据 {result.used.papers} 篇 · {result.used.scopeLabel}
                </Badge>
                <Badge variant="secondary" className="text-[9px]">
                  <Quote className="h-2.5 w-2.5 mr-0.5" />
                  {result.citations.known} 处引用
                </Badge>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => copy(result.content, '已复制到剪贴板')}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-2.5 w-2.5" /> 复制
                </button>
                <button
                  onClick={() =>
                    copy(`# 文献综述: ${topic}\n\n${result.content}\n`, '已复制为 Markdown 格式')
                  }
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <FileText className="h-2.5 w-2.5" /> MD
                </button>
              </div>
            </div>

            {/* 模型编造的引用：导出前几乎不可能被发现，所以必须当场提示 */}
            {result.citations.unknown.length > 0 && (
              <div className="mb-2 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px]">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />
                <span>
                  有 {result.citations.unknown.length} 处引用不在本次范围内（可能是模型编造的）：
                  {result.citations.unknown.slice(0, 4).join('、')}
                  {result.citations.unknown.length > 4 ? ' 等' : ''}
                  。插入稿件后这些引用会显示为「查不到」，请手动核对。
                </span>
              </div>
            )}

            {result.used.excludedByScope > 0 && (
              <p className="mb-2 text-[10px] text-muted-foreground">
                另有 {result.used.excludedByScope} 篇因不在「{result.used.scopeLabel}」范围内被排除；
                想纳入就把它们标记为已读，或把范围放宽。
              </p>
            )}

            <div className="max-h-[500px] overflow-y-auto">
              <AiMarkdown content={result.content} size="default" />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-primary/20 pt-2">
              <Button size="sm" onClick={sendToWorkbench}>
                <PenLine className="h-3.5 w-3.5 mr-1.5" />
                发到写作工作台
              </Button>
              <span className="text-[10px] text-muted-foreground">
                会插入为新章节；正文里的 [@论文] 标记将自动变成编号并生成参考文献表
              </span>
            </div>
          </div>
        )}

        {/* Tip */}
        {!result && !loading && (
          <div className="text-center text-[10px] text-muted-foreground py-1">
            <Globe className="h-2.5 w-2.5 inline mr-1" />
            综述 = 分类 + 对比 + 指出 Gap；引用只认文献库里的论文，编号交给写作工作台
          </div>
        )}
      </CardContent>
    </Card>
  )
}
