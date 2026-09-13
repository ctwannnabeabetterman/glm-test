'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Sparkles, Search, Loader2, Copy } from 'lucide-react'
import { toast } from 'sonner'

export function AIDirectionExplorer() {
  const [candidate, setCandidate] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  const explore = async () => {
    if (!candidate.trim()) {
      toast.error('请先输入一个候选研究方向')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/ai-direction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '分析失败')
      setResult(data.content)
      toast.success('方向探索完成')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" /> AI 方向探索与创新性检查
        </CardTitle>
        <CardDescription className="text-xs">
          先基于本地论文库查重复，再拆解问题/方法/场景/组合创新，最后生成可写进论文的贡献草案。AI 结果需要用真实文献和实验复核。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={candidate}
          onChange={(e) => setCandidate(e.target.value)}
          placeholder="例如：面向卫星互联网的多智能体强化学习路由与链路故障快速恢复"
          className="min-h-[78px] text-xs"
        />
        <Button onClick={explore} disabled={loading} size="sm">
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
          检查重复度与创新空间
        </Button>
        {result && (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-medium">
              分析结果
              <button
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => { void navigator.clipboard.writeText(result); toast.success('已复制') }}
              >
                <Copy className="h-3 w-3" />复制
              </button>
            </div>
            <div className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{result}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
