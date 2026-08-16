'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Sparkles, Copy, Loader2, FileText, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function AIAbstractGenerator() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    authors: '',
    venue: '',
    method: '',
    problem: '',
    contribution: '',
  })

  const generate = async () => {
    if (!form.title.trim()) {
      toast.error('请填写论文标题')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/ai-abstract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.success) {
        setResult(data.content)
        toast.success('摘要已生成')
      } else {
        toast.error(data.error || '生成失败')
      }
    } catch (e) {
      toast.error('AI 生成失败: ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    if (!result) return
    navigator.clipboard.writeText(result)
    toast.success('已复制到剪贴板')
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              AI 摘要生成器
            </CardTitle>
            <CardDescription className="text-xs">
              基于论文信息 · AI 自动生成 4 句话英文摘要 + 中文翻译
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[9px] bg-primary/5">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            LLM
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Input form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs">论文标题 *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="例如: Deep Reinforcement Learning for Resource Allocation in RIS-assisted Networks"
              className="mt-1 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">作者</Label>
            <Input
              value={form.authors}
              onChange={(e) => setForm({ ...form, authors: e.target.value })}
              placeholder="Nasir, Y. S., Guo, D."
              className="mt-1 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">目标期刊/会议</Label>
            <Input
              value={form.venue}
              onChange={(e) => setForm({ ...form, venue: e.target.value })}
              placeholder="IEEE ICC 2026"
              className="mt-1 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">研究方法</Label>
            <Input
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
              placeholder="多智能体 DRL + Attention 机制"
              className="mt-1 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">研究问题</Label>
            <Input
              value={form.problem}
              onChange={(e) => setForm({ ...form, problem: e.target.value })}
              placeholder="RIS 辅助网络中的多用户干扰管理"
              className="mt-1 text-xs"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">主要贡献（可选）</Label>
            <Textarea
              value={form.contribution}
              onChange={(e) => setForm({ ...form, contribution: e.target.value })}
              placeholder="提出 attention-based MADRL 框架，吞吐量提升 25%，收敛速度提升 40%"
              className="mt-1 text-xs min-h-[60px]"
            />
          </div>
        </div>

        {/* Generate button */}
        <Button
          onClick={generate}
          disabled={loading || !form.title.trim()}
          className="w-full"
          size="sm"
        >
          {loading ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> AI 生成中...</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> 生成摘要</>
          )}
        </Button>

        {/* Result */}
        {result && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-primary">AI 生成结果</span>
              </div>
              <button
                onClick={copy}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-2.5 w-2.5" /> 复制
              </button>
            </div>
            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans">
              {result}
            </pre>
          </div>
        )}

        {/* Tip */}
        {!result && !loading && (
          <div className="text-center text-[10px] text-muted-foreground py-1">
            💡 方法论 §5.1.2 Abstract 四句话模板：背景句 + 问题句 + 方法句 + 结果句
          </div>
        )}
      </CardContent>
    </Card>
  )
}
