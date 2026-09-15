'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { SectionHeader } from './papers-section'
import { toast } from 'sonner'
import { Settings, KeyRound, Plug, CheckCircle2, AlertCircle, ExternalLink, Loader2, Database, Info, BookMarked, FolderOpen, FolderSync } from 'lucide-react'
import {
  DEFAULT_OBSIDIAN_STATUS,
  loadObsidianStatus,
  pickVaultDir,
  saveObsidianStatus,
  syncToObsidian,
  type ObsidianStatus,
} from '@/lib/obsidian-client'

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
  const [zoteroUserId, setZoteroUserId] = useState('')
  const [zoteroKey, setZoteroKey] = useState('')
  const [zoteroCollection, setZoteroCollection] = useState('')
  const [zoteroHint, setZoteroHint] = useState('')
  const [zoteroSaving, setZoteroSaving] = useState(false)
  const [zoteroSyncing, setZoteroSyncing] = useState(false)
  const [obsidian, setObsidian] = useState<ObsidianStatus>(DEFAULT_OBSIDIAN_STATUS)
  const [vaultInput, setVaultInput] = useState('')
  const [subfolderInput, setSubfolderInput] = useState('AI Network Lab')
  const [obsidianSaving, setObsidianSaving] = useState(false)
  const [obsidianSyncing, setObsidianSyncing] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/llm')
    const data: LlmStatus = await res.json()
    setStatus(data)
    setBaseUrl(data.baseUrl)
    setModel(data.model)
    const matched = data.presets.find((p) => p.baseUrl === data.baseUrl)
    setPresetId(matched?.id ?? 'custom')
    try {
      const z = await fetch('/api/zotero/sync').then((r) => r.json())
      setZoteroUserId(z.userId || '')
      setZoteroCollection(z.collectionKey || '')
      setZoteroHint(z.keyHint || '')
    } catch {
      /* ignore */
    }
    const o = await loadObsidianStatus()
    setObsidian(o)
    setVaultInput(o.vaultPath || '')
    setSubfolderInput(o.subfolder ?? 'AI Network Lab')
  }, [])

  useEffect(() => {
    // 挂载时拉取当前生效配置；load 内所有 setState 均在 await fetch 之后，
    // 属合法的「取数挂载」模式，非同步级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  /** 保存 vault 配置；保存后会实测目录是否真的是一个已存在目录 */
  const saveObsidian = async (patch?: { vaultPath?: string; subfolder?: string; enabled?: boolean }) => {
    setObsidianSaving(true)
    try {
      const next = await saveObsidianStatus({
        vaultPath: patch?.vaultPath ?? vaultInput,
        subfolder: patch?.subfolder ?? subfolderInput,
        enabled: patch?.enabled ?? obsidian.enabled,
      })
      setObsidian(next)
      setVaultInput(next.vaultPath || '')
      setSubfolderInput(next.subfolder ?? '')
      if (next.ready) toast.success('Obsidian 笔记库已连通', { description: next.vaultPath })
      else toast.warning('配置已保存，但目录暂不可用', { description: next.vaultError || '请检查路径' })
    } catch (e) {
      toast.error('保存失败：' + (e as Error).message)
    } finally {
      setObsidianSaving(false)
    }
  }

  /** 调起系统原生目录选择器（仅在桌面端可用，浏览器端退回手填） */
  const chooseVaultDir = async () => {
    const picked = await pickVaultDir()
    if (picked.canceled) return
    if (!picked.ok || !picked.path) {
      toast.error(picked.error || '选择目录失败', {
        description: picked.available ? undefined : '当前是浏览器预览环境，请手动填写 vault 绝对路径',
      })
      return
    }
    setVaultInput(picked.path)
    await saveObsidian({ vaultPath: picked.path, subfolder: subfolderInput })
  }

  /** 把文献笔记批量写入 vault，交给 Obsidian 管理 */
  const syncAllToObsidian = async () => {
    if (!obsidian.ready) {
      toast.error('vault 尚未连通', { description: '先选择 vault 目录并保存' })
      return
    }
    setObsidianSyncing(true)
    try {
      const result = await syncToObsidian('category', { category: 'literature' })
      if (!result.ok && !result.writtenCount) {
        toast.error(result.error || '同步失败')
        return
      }
      toast.success(`已同步 ${result.writtenCount ?? 0} 篇笔记到 Obsidian`, { description: result.dir })
      if (result.skipped) toast.warning(`有 ${result.skipped} 篇被跳过（文件名非法）`)
    } catch (e) {
      toast.error('同步失败：' + (e as Error).message)
    } finally {
      setObsidianSyncing(false)
    }
  }

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
                <BookMarked className="h-5 w-5" /> Zotero 同步
              </CardTitle>
              <CardDescription>
                Zotero 仍是文献主库。这里只拉条目元数据写入论文列表，不会自动让 LLM 读 PDF。User ID 在 zotero.org/settings/keys 页面顶部。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>User ID</Label>
                <Input value={zoteroUserId} onChange={(e) => setZoteroUserId(e.target.value)} placeholder="例如 1234567" />
              </div>
              <div className="space-y-2">
                <Label>API Key{zoteroHint ? `（已保存 ${zoteroHint}）` : ''}</Label>
                <Input type="password" value={zoteroKey} onChange={(e) => setZoteroKey(e.target.value)} placeholder="粘贴 Zotero API Key" />
              </div>
              <div className="space-y-2">
                <Label>Collection Key（可选，留空同步整个库）</Label>
                <Input value={zoteroCollection} onChange={(e) => setZoteroCollection(e.target.value)} placeholder="ABCDEF12" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={zoteroSaving}
                  onClick={async () => {
                    setZoteroSaving(true)
                    try {
                      const body: Record<string, string> = { userId: zoteroUserId, collectionKey: zoteroCollection }
                      if (zoteroKey.trim()) body.apiKey = zoteroKey.trim()
                      const res = await fetch('/api/zotero/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error)
                      setZoteroHint(data.keyHint || '')
                      setZoteroKey('')
                      toast.success('Zotero 配置已保存')
                    } catch (e) {
                      toast.error((e as Error).message)
                    } finally {
                      setZoteroSaving(false)
                    }
                  }}
                >
                  {zoteroSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}保存 Zotero
                </Button>
                <Button
                  disabled={zoteroSyncing}
                  onClick={async () => {
                    setZoteroSyncing(true)
                    try {
                      const res = await fetch('/api/zotero/sync', { method: 'POST' })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error)
                      toast.success(`同步完成：新增 ${data.created}，更新 ${data.updated}`)
                    } catch (e) {
                      toast.error((e as Error).message)
                    } finally {
                      setZoteroSyncing(false)
                    }
                  }}
                >
                  {zoteroSyncing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  立即同步
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookMarked className="h-5 w-5" /> Obsidian 笔记库
              </CardTitle>
              <CardDescription>
                把科研笔记直接写入 Obsidian vault（YAML frontmatter + #标签），交给 Obsidian 做索引、双链与检索——不用再手动搬运文件
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="vault-path">Vault 目录</Label>
                <div className="flex gap-2">
                  <Input
                    id="vault-path"
                    value={vaultInput}
                    onChange={(e) => setVaultInput(e.target.value)}
                    placeholder="例如 D:/Obsidian/MyVault"
                  />
                  <Button type="button" variant="outline" onClick={() => void chooseVaultDir()} disabled={obsidianSaving}>
                    <FolderOpen className="mr-1 h-4 w-4" /> 选择
                  </Button>
                </div>
                {obsidian.vaultPath ? (
                  obsidian.ready ? (
                    <div className="flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> 目录可用，笔记将写入
                      <code className="rounded bg-muted px-1">
                        {obsidian.vaultPath}
                        {obsidian.subfolder ? `/${obsidian.subfolder}` : ''}
                      </code>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-xs text-amber-600">
                      <AlertCircle className="h-3.5 w-3.5" /> {obsidian.vaultError || '目录不可用'}
                    </div>
                  )
                ) : (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5" /> 未配置时，「导出 Markdown」仍走原来的「另存为」
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="vault-sub">Vault 内子目录</Label>
                <Input
                  id="vault-sub"
                  value={subfolderInput}
                  onChange={(e) => setSubfolderInput(e.target.value)}
                  placeholder="AI Network Lab（留空 = 直接写 vault 根目录）"
                />
                <p className="text-[11px] text-muted-foreground">
                  相对路径；绝对路径与 <code className="rounded bg-muted px-1">..</code> 会被自动净化，避免污染你已有的 vault 结构
                </p>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">导出 Markdown 时顺便写入 vault</div>
                  <div className="text-[11px] text-muted-foreground">关闭后只保留「另存为」下载，vault 写入需手动触发</div>
                </div>
                <Switch
                  checked={obsidian.enabled}
                  disabled={obsidianSaving}
                  onCheckedChange={(v) => void saveObsidian({ enabled: v })}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void saveObsidian()} disabled={obsidianSaving}>
                  {obsidianSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  保存并测试目录
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void syncAllToObsidian()}
                  disabled={obsidianSyncing || !obsidian.ready}
                >
                  {obsidianSyncing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FolderSync className="mr-1 h-4 w-4" />}
                  同步全部文献笔记
                </Button>
              </div>
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
              <p>· 推荐工作流：Zotero 管文献 → 本软件同步列表/写阅读笔记/做实验 → 一键写入 Obsidian vault 长期管理</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
