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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SectionHeader } from '@/components/section-header'
import { AiMarkdown } from '@/components/ai-markdown'
import { useAppStore } from '@/lib/store'
import { RESULT_DENSITY_PRESETS, normalizeResultDensity } from '@/lib/result-density'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Settings, KeyRound, Plug, CheckCircle2, AlertCircle, ExternalLink, Loader2, Database, Info, BookMarked, FolderOpen, FolderSync, RefreshCw, Download, Rocket, PackageCheck, Type } from 'lucide-react'
import {
  DEFAULT_OBSIDIAN_STATUS,
  loadObsidianStatus,
  pickVaultDir,
  saveObsidianStatus,
  syncToObsidian,
  type ObsidianStatus,
} from '@/lib/obsidian-client'
import {
  hasDesktopUpdate,
  getAppInfo,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  onUpdateStatus,
  type AppInfo,
  type UpdateCheckResult,
  type UpdateStatusPayload,
} from '@/lib/desktop-update'
import { clampPercent, describeDownloadDetail, formatUpdateSpeed } from '@/lib/update-progress'

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

/**
 * 密度预览用的样张。
 *
 * 刻意挑的是「AI 面板真实会吐出来的东西」而不是 lorem ipsum：标题 + 加粗 + 列表 + 表格，
 * 三档密度之间的差异（字号、行高、衬线）在这四种元素上都能被看见；
 * 用几个字的一句话做样张的话，三档看着几乎一样，用户等于在盲选。
 */
const DENSITY_PREVIEW_MD = [
  '## 语义通信方向的研究缺口',
  '',
  '现有工作多在**理想信道假设**下报告端到端准确率，缺少对信道估计误差的敏感性分析。',
  '',
  '- 评测指标口径不统一，不同论文的「准确率」不可横向比较',
  '- 噪声注入配置未公开，结果难以复现',
  '',
  '| 方案 | 信道模型 | 报告准确率 |',
  '| --- | --- | --- |',
  '| JSCC-CNN | AWGN | 92.1% |',
  '| 改进型 JSCC | 瑞利衰落 | 88.4% |',
].join('\n')

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

  // ---- 软件更新 ----
  // 桌面壳里才有更新能力；浏览器直跑（npm run dev）时整块只做说明展示
  const [desktopUpdate, setDesktopUpdate] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateState, setUpdateState] = useState<UpdateStatusPayload | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [installing, setInstalling] = useState(false)

  // ---- 界面与阅读 ----
  // 呈现密度是纯前端偏好，走 zustand 持久化（与主题同一份 store），不进数据库：
  // 它是「这台机器上这个人的阅读习惯」，没有跨设备同步的价值，也不该占用后端往返。
  const resultDensity = useAppStore((s) => s.resultDensity)
  const setResultDensity = useAppStore((s) => s.setResultDensity)

  useEffect(() => {
    let alive = true
    // 放进 then 回调而不是 effect 体内同步执行：避免「同步 setState 触发级联渲染」，
    // 也顺带避开 SSR 没有 window 的问题（服务端先渲染「浏览器环境」，挂载后再补真实态）
    void getAppInfo().then((info) => {
      if (!alive) return
      setDesktopUpdate(hasDesktopUpdate())
      setAppInfo(info)
      if (info?.updateStatus) setUpdateState(info.updateStatus)
    })
    // 主进程推来的状态（例如启动后后台检查发现新版本）同步到这张卡片
    const off = onUpdateStatus((p) => {
      setUpdateState(p)
      // 一旦进入「正在下载 / 已下载 / 出错 / 版本冲突」，之前那次手动检查的结论就已经过期了。
      // 不清掉的话，状态行会用 updateResult 覆盖新状态 —— 用户会看到「已下载完成」的按钮
      // 旁边还写着「点『下载更新』」，前后矛盾，看着就像界面坏了。
      if (p.state === 'downloading' || p.state === 'downloaded' || p.state === 'error' || p.state === 'conflict') {
        setUpdateResult(null)
      }
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const runUpdateCheck = useCallback(async () => {
    setChecking(true)
    setUpdateResult(null)
    try {
      const r = await checkForUpdates()
      setUpdateResult(r)
      if (r.ok && r.hasUpdate) toast.success(`发现新版本 ${r.latest}`)
      else if (r.ok) toast.success('已是最新版本')
      else toast.error(r.error || '检查更新失败')
    } finally {
      setChecking(false)
    }
  }, [])

  const runDownload = useCallback(async () => {
    setDownloading(true)
    setUpdateResult(null) // 检查结论已被「开始下载」取代，留着会让状态行自相矛盾
    try {
      const r = await downloadUpdate()
      if (!r.ok) toast.error(r.error || '下载更新失败')
      else toast.success('已开始下载，完成后会提示重启安装')
    } finally {
      setDownloading(false)
    }
  }, [])

  const runInstall = useCallback(async () => {
    setInstalling(true)
    setUpdateResult(null)
    try {
      const r = await installUpdate()
      if (!r.ok) toast.error(r.error || '安装更新失败')
    } finally {
      setInstalling(false)
    }
  }, [])

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
                <Type className="h-5 w-5" /> 界面与阅读
              </CardTitle>
              <CardDescription>
                AI 结果的呈现密度。只改 AI 输出（摘要 / 综述 / 选题分析 / 实验顾问等）的字号与行高，不动界面其余部分。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup
                value={resultDensity}
                onValueChange={(v) => setResultDensity(normalizeResultDensity(v))}
                className="gap-2"
              >
                {RESULT_DENSITY_PRESETS.map((preset) => {
                  const selected = resultDensity === preset.id
                  return (
                    <Label
                      key={preset.id}
                      htmlFor={`result-density-${preset.id}`}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors',
                        selected ? 'border-primary bg-accent' : 'hover:bg-muted',
                      )}
                    >
                      <RadioGroupItem value={preset.id} id={`result-density-${preset.id}`} className="mt-0.5" />
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">{preset.name}</div>
                        <div className="text-[11px] text-muted-foreground">{preset.summary}</div>
                      </div>
                    </Label>
                  )
                })}
              </RadioGroup>

              {/* 预览即实物：密度是全局的，所以下面这块就是 AI 结果此刻的样子，
                  不需要另做一套「假预览」（假预览反而会和真实渲染对不上）。 */}
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="eyebrow mb-2">实时预览</div>
                <AiMarkdown content={DENSITY_PREVIEW_MD} />
              </div>

              <p className="text-[11px] text-muted-foreground">
                选择立即生效并记住；已生成的结果会直接跟着变，不需要重新跑一次 AI。
              </p>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackageCheck className="h-5 w-5" /> 软件更新
              </CardTitle>
              <CardDescription>
                当前版本
                <Badge variant="secondary" className="mx-1 font-mono">
                  v{appInfo?.version ?? '—'}
                </Badge>
                {appInfo?.ok && !appInfo.isPackaged && '（开发模式，不检查更新）'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!desktopUpdate ? (
                <p className="text-sm text-muted-foreground">
                  检查更新只在桌面客户端里可用。浏览器里也可以手动对比发布页确认版本。
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => void runUpdateCheck()} disabled={checking}>
                      {checking ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 h-4 w-4" />
                      )}
                      检查更新
                    </Button>
                    {updateState?.state === 'available' && (
                      <Button size="sm" variant="outline" onClick={() => void runDownload()} disabled={downloading}>
                        {downloading ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-1.5 h-4 w-4" />
                        )}
                        下载更新
                      </Button>
                    )}
                    {updateState?.state === 'downloaded' && (
                      <Button size="sm" variant="outline" onClick={() => void runInstall()} disabled={installing}>
                        {installing ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Rocket className="mr-1.5 h-4 w-4" />
                        )}
                        立即重启并安装
                      </Button>
                    )}
                    {/* 停滞是「下载卡住」里最常见的一种，必须给一条当场能走的路：
                        主进程已判过停滞，这里再点一次就是重新发起下载，不用退出重进。 */}
                    {updateState?.state === 'error' && updateState.reason === 'stalled' && (
                      <Button size="sm" variant="outline" onClick={() => void runDownload()} disabled={downloading}>
                        {downloading ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 h-4 w-4" />
                        )}
                        重试下载
                      </Button>
                    )}
                  </div>
                  <UpdateStatusLine state={updateState} result={updateResult} />
                  {/* 兜底通道：桌面端 NSIS 安装器要先把旧版本目录整个移开，
                      只要还有程序占着安装目录（把它当工作目录的编辑器、同步盘、杀软等），
                      这一步就会卡住或中止。这种情况下应用内更新无解，必须给用户一条能走通的路。 */}
                  <a
                    href="https://github.com/ctwannnabeabetterman/glm-test/releases/latest"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    更新反复失败？到发布页手动下载安装包 <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

type UpdateTone = 'ok' | 'pending' | 'error'

interface UpdateLine {
  tone: UpdateTone
  title: string
  hint?: string
  /** 0–100；仅 downloading 时有值，用于渲染进度条 */
  progress?: number
}

/** 把主进程给的 reason 翻译成「下一步该干什么」 */
function hintForReason(reason?: string): string | undefined {
  switch (reason) {
    case 'no-release':
      return '这是发布侧的问题：更新源上没有可用的正式 Release（不是本机故障）。'
    case 'no-channel':
      return '更新源缺少 latest.yml，说明上一次发布流程没有跑完。'
    case 'network':
      return '请检查网络或代理设置后重试。'
    case 'stalled':
      return '下载连续 45 秒没有收到任何数据，已判定卡住（多半是网络无法稳定访问 GitHub）。可点「重试下载」；若反复卡住，请用下面的发布页手动下载。'
    case 'dev':
      return '开发模式不检查更新，请用打包后的客户端。'
    case 'no-updater':
      return '打包时没把更新组件带进去，建议重新安装一次。'
    case 'no-bridge':
      return '当前是浏览器环境，没有更新能力。'
    default:
      return undefined
  }
}

function describeUpdateState(state: UpdateStatusPayload | null): UpdateLine | null {
  if (!state) return null
  switch (state.state) {
    case 'checking':
      return { tone: 'pending', title: '正在检查更新…' }
    case 'available':
      return {
        tone: 'ok',
        title: `发现新版本 ${state.version}`,
        hint: `当前 ${state.current}。点「下载更新」开始下载（约 140 MB，视网络 1–5 分钟）；下载完成后需要重启应用才能装上新版。`,
      }
    case 'latest':
      return { tone: 'ok', title: `已是最新版本${state.current ? `（${state.current}）` : ''}` }
    case 'downloading': {
      // 显示速度与已下载量：否则用户只能盯着一个长时间不动的百分比，
      // 分不清「在慢慢下」还是「已经卡死」——这正是「下载无法完成」的观感来源。
      const speed = formatUpdateSpeed(state.speed)
      const pct = clampPercent(state.percent)
      const detail = describeDownloadDetail(state)
      return {
        tone: 'pending',
        title: `正在下载更新 ${pct}%${speed ? `（${speed}）` : ''}`,
        hint: detail
          ? `${detail}。下载期间可以继续使用；完成后会提示重启安装。`
          : '下载期间可以继续使用；完成后会提示重启安装。',
        // 进度条：主进程一直在推 percent，之前只渲染成文字，用户看不出「在动」
        progress: pct,
      }
    }
    case 'downloaded':
      return {
        tone: 'ok',
        title: `新版本 ${state.version} 已下载完成`,
        hint:
          '点「立即重启并安装」生效。安装时会静默进行、**不显示进度条**：' +
          '窗口先关闭，约 10–60 秒后应用自己回来，属于正常现象。' +
          (state.file ? `安装包存放于 ${state.file}` : ''),
      }
    case 'error':
      return { tone: 'error', title: state.message || '检查更新失败', hint: hintForReason(state.reason) }
    case 'conflict':
      return {
        tone: 'error',
        title: '检测到另一个版本的客户端正在运行',
        hint: '请关闭它再继续使用：两个版本同时运行会并发写同一个本地数据库，可能损坏数据。',
      }
    default:
      return null
  }
}

function UpdateStatusLine({
  state,
  result,
}: {
  state: UpdateStatusPayload | null
  result: UpdateCheckResult | null
}) {
  // 手动检查的结果优先（它带回了 latest/current 这类具体字段），其次才是推过来的状态
  let line: UpdateLine | null = null
  if (result) {
    if (!result.ok) {
      line = { tone: 'error', title: result.error || '检查更新失败', hint: hintForReason(result.reason) }
    } else if (result.hasUpdate) {
      line = {
        tone: 'ok',
        title: `发现新版本 ${result.latest}`,
        hint: `当前 ${result.current}，点「下载更新」，下载完成后会提示重启安装。`,
      }
    } else {
      line = { tone: 'ok', title: `已是最新版本（${result.current}）` }
    }
  } else {
    line = describeUpdateState(state)
  }

  if (!line) {
    return <p className="text-xs text-muted-foreground">还没有检查过，点上面的按钮可以手动检查一次。</p>
  }

  const Icon = line.tone === 'error' ? AlertCircle : line.tone === 'pending' ? Loader2 : CheckCircle2
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-xs',
        line.tone === 'error' ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-muted/40',
      )}
    >
      <div className="flex items-start gap-1.5">
        <Icon
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0',
            line.tone === 'error' ? 'text-destructive' : line.tone === 'pending' ? 'animate-spin text-muted-foreground' : 'text-primary',
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{line.title}</p>
          {line.hint && <p className="mt-0.5 text-muted-foreground">{line.hint}</p>}
          {/* 下载进度条：主进程一直有推 percent，之前只把它渲染成文字，
              用户盯着一个数字分不清「在慢慢下」还是「卡住了」。 */}
          {typeof line.progress === 'number' && (
            <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-border">
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(0, Math.min(100, line.progress))}%` }}
              />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
