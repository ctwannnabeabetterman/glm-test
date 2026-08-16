'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { SectionHeader } from './papers-section'
import { toast } from 'sonner'
import { Settings, KeyRound, Plug, CheckCircle2, AlertCircle, ExternalLink, Loader2, Database, Info } from 'lucide-react'

interface Preset {
  id: string
  name: string
  baseUrl: string
  model: string
  keyUrl: string
}

interface LlmStatus {
  baseUrl: string
  model: string
  hasKey: boolean
  source: 'database' | 'env' | 'default'
  keyHint: string
  envKeyConfigured: boolean
  presets: Preset[]
}

export function SettingsSection() {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [presetId, setPresetId] = useState('zhipu')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latency?: number } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/llm')
    const data: LlmStatus = await res.json()
    setStatus(data)
    setBaseUrl(data.baseUrl)
    setModel(data.model)
    const matched = data.presets.find((p) => p.baseUrl === data.baseUrl)
    setPresetId(matched?.id ?? 'custom')
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const applyPreset = (id: string) => {
    setPresetId(id)
    const preset = status?.presets.find((p) => p.id === id)
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl)
      setModel(preset.model)
    }
  }

  const save = async (clearKey = false) => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { baseUrl, model }
      if (clearKey) body.clearApiKey = true
      else if (apiKey.trim()) body.apiKey = apiKey.trim()
      const res = await fetch('/api/settings/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(clearKey ? '已清除 API Key' : '配置已保存')
      setApiKey('')
      setTestResult(null)
      await load()
    } catch (e) {
      toast.error('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/settings/llm/test', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setTestResult({ ok: true, message: `连通成功（${data.model}，${data.latencyMs}ms）：${data.reply}`, latency: data.latencyMs })
      } else {
        setTestResult({ ok: false, message: data.error })
      }
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const sourceLabel = { database: '应用内配置', env: '环境变量 .env', default: '默认（未配置）' }

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Settings}
        title="系统设置"
        desc="LLM 网关接入个人 API Key，兼容智谱 GLM / DeepSeek / OpenAI / Ollama 等任意 OpenAI 兼容接口"
      />

      {!status?.hasKey && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>尚未配置 API Key</AlertTitle>
          <AlertDescription>
            AI 摘要、综述生成、实验顾问等 6 个 AI 功能需要 LLM 支持。推荐智谱
            <code className="mx-1 rounded bg-muted px-1">glm-4-flash</code>
            （免费模型）：注册 open.bigmodel.cn 后在下方填入 API Key 即可。
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" /> LLM 服务配置
            </CardTitle>
            <CardDescription>
              当前生效：
              <Badge variant={status?.hasKey ? 'default' : 'secondary'} className="mx-1">
                {status ? sourceLabel[status.source] : '加载中'}
              </Badge>
              {status?.keyHint && <span className="ml-1 font-mono text-xs">{status.keyHint}</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>服务商预设</Label>
              <Select value={presetId} onValueChange={applyPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="选择服务商" />
                </SelectTrigger>
                <SelectContent>
                  {status?.presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {status?.presets.find((p) => p.id === presetId)?.keyUrl && (
                <a
                  href={status.presets.find((p) => p.id === presetId)!.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  获取该服务商的 API Key <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="llm-base">Base URL（OpenAI 兼容）</Label>
              <Input id="llm-base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://open.bigmodel.cn/api/paas/v4" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="llm-model">模型名称</Label>
              <Input id="llm-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="glm-4-flash" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="llm-key">API Key{status?.keyHint ? `（已保存 ${status.keyHint}，留空保持不变）` : ''}</Label>
              <Input id="llm-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={status?.envKeyConfigured ? '环境变量已配置，此处可覆盖' : '粘贴你的 API Key'} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => save()} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}保存配置
              </Button>
              <Button variant="outline" onClick={test} disabled={testing}>
                {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plug className="mr-1 h-4 w-4" />}测试连通
              </Button>
              {status?.keyHint && (
                <Button variant="ghost" onClick={() => save(true)} disabled={saving}>
                  清除已存 Key
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plug className="h-5 w-5" /> 连通性测试
              </CardTitle>
              <CardDescription>向所选服务发送一次最小补全请求，验证 Key、Base URL 与模型名</CardDescription>
            </CardHeader>
            <CardContent>
              {testResult === null ? (
                <p className="text-sm text-muted-foreground">点击左侧「测试连通」查看结果</p>
              ) : testResult.ok ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <AlertTitle>连通成功 · {testResult.latency}ms</AlertTitle>
                  <AlertDescription>{testResult.message}</AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>连接失败</AlertTitle>
                  <AlertDescription className="break-all">{testResult.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" /> 数据与安全说明
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>· API Key 仅保存在本机 SQLite（个人单机部署场景），不会上传到任何第三方</p>
              <p>· 也可不进应用，直接在项目根目录 <code className="rounded bg-muted px-1">.env</code> 写入 <code className="rounded bg-muted px-1">LLM_API_KEY</code></p>
              <p>· 应用内配置优先于环境变量；读取接口只返回脱敏 Key</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
