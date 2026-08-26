'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAppStore, type Section } from '@/lib/store'
import {
  BookOpen,
  Target,
  FlaskConical,
  StickyNote,
  LayoutDashboard,
  Search as SearchIcon,
  Calendar,
  PenLine,
  GraduationCap,
  CornerDownLeft,
  Command as CommandIcon,
  Network,
  Settings as SettingsIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchResult {
  id: string
  type: 'paper' | 'topic' | 'note' | 'experiment'
  title: string
  subtitle: string
  meta: string
  tags?: string
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  paper: BookOpen,
  topic: Target,
  note: StickyNote,
  experiment: FlaskConical,
}

const TYPE_COLORS: Record<string, string> = {
  paper: 'text-emerald-600 bg-emerald-500/10',
  topic: 'text-amber-600 bg-amber-500/10',
  note: 'text-blue-600 bg-blue-500/10',
  experiment: 'text-purple-600 bg-purple-500/10',
}

const TYPE_LABELS: Record<string, string> = {
  paper: '论文',
  topic: '课题',
  note: '笔记',
  experiment: '实验',
}

const NAV_COMMANDS: { id: Section; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; group: string }[] = [
  { id: 'overview', label: '总览仪表盘', desc: '查看项目概览和统计', icon: LayoutDashboard, group: '导航' },
  { id: 'papers', label: '论文库', desc: 'Zotero 风格论文管理', icon: BookOpen, group: '导航' },
  { id: 'search', label: '文献检索工具', desc: '关键词矩阵 · arXiv 监控', icon: SearchIcon, group: '导航' },
  { id: 'topics', label: '选题评估', desc: '4 维加权打分矩阵', icon: Target, group: '导航' },
  { id: 'experiments', label: '实验管理', desc: '基线检查 · 超参数 · 消融', icon: FlaskConical, group: '导航' },
  { id: 'planner', label: '研究规划', desc: 'Gantt · 写作时间线 · 周计划', icon: Calendar, group: '导航' },
  { id: 'writing', label: '论文写作', desc: '结构检查 · 学术句式', icon: PenLine, group: '导航' },
  { id: 'notes', label: '科研笔记', desc: 'Obsidian 风格笔记', icon: StickyNote, group: '导航' },
  { id: 'methodology', label: '方法论浏览', desc: '6 模块完整指南', icon: GraduationCap, group: '导航' },
  { id: 'simlab', label: '组网仿真实验', desc: '种子化可复现仿真 · 三算法对比', icon: Network, group: '导航' },
  { id: 'settings', label: '系统设置', desc: 'LLM API Key · 服务商配置', icon: SettingsIcon, group: '导航' },
]

const QUICK_ACTIONS: { id: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; section: Section; group: string }[] = [
  { id: 'add-paper', label: '添加新论文', desc: '在论文库中添加新论文', icon: BookOpen, section: 'papers', group: '快捷操作' },
  { id: 'new-topic', label: '新建课题评估', desc: '创建新的选题评估', icon: Target, section: 'topics', group: '快捷操作' },
  { id: 'new-experiment', label: '新建实验', desc: '创建新的实验记录', icon: FlaskConical, section: 'experiments', group: '快捷操作' },
  { id: 'new-note', label: '新建笔记', desc: '创建新的科研笔记', icon: StickyNote, section: 'notes', group: '快捷操作' },
  { id: 'arxiv-search', label: 'arXiv 论文监控', desc: '搜索最新 arXiv 论文', icon: SearchIcon, section: 'search', group: '快捷操作' },
  { id: 'gantt', label: '查看 Gantt 图', desc: '40 周研究计划', icon: Calendar, section: 'planner', group: '快捷操作' },
  { id: 'abstract', label: 'Abstract 生成器', desc: '四句话摘要模板', icon: PenLine, section: 'writing', group: '快捷操作' },
  { id: 'export-data', label: '导出数据备份', desc: '导出 JSON 备份文件', icon: LayoutDashboard, section: 'overview', group: '快捷操作' },
  { id: 'run-sim', label: '运行组网仿真', desc: 'Dijkstra/负载感知/Q-Learning 对比', icon: Network, section: 'simlab', group: '快捷操作' },
  { id: 'llm-key', label: '配置 LLM API Key', desc: '接入个人智谱/DeepSeek/Ollama Key', icon: SettingsIcon, section: 'settings', group: '快捷操作' },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const setSection = useAppStore((s) => s.setSection)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Global keyboard shortcut Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // Debounced search —— 所有 setState 都发生在定时器回调（事件语义）内，
  // 避免 effect 内同步 setState 触发级联渲染
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    debounceRef.current = setTimeout(
      async () => {
        if (!q) {
          setResults([])
          setLoading(false)
          return
        }
        setLoading(true)
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
          const data = await res.json()
          setResults(data.results || [])
        } catch {
          setResults([])
        } finally {
          setLoading(false)
        }
      },
      q ? 250 : 0
    )
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const navigateTo = useCallback((section: Section) => {
    setSection(section)
    setOpen(false)
    setQuery('')
    setResults([])
  }, [setSection])

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border border-border bg-background/95 backdrop-blur px-3 py-2 text-xs shadow-lg hover:shadow-xl hover:border-primary/40 transition-all group"
        aria-label="打开命令面板"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
          <SearchIcon className="h-3.5 w-3.5" />
        </div>
        <span className="hidden sm:inline text-muted-foreground">搜索或跳转</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
          <CommandIcon className="h-2.5 w-2.5" />K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0 top-[20%] translate-y-0" aria-describedby={undefined}>
          <DialogTitle className="sr-only">命令面板 - 搜索和导航</DialogTitle>
          <Command shouldFilter={false} className="rounded-lg">
            <div className="flex items-center border-b border-border px-3">
              <SearchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <CommandInput
                placeholder="搜索论文、课题、笔记、实验，或输入命令..."
                value={query}
                onValueChange={setQuery}
                className="flex-1 h-12 bg-transparent focus:outline-none text-sm"
              />
              {loading && (
                <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin mr-2" />
              )}
              <kbd className="text-[9px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                ESC
              </kbd>
            </div>

            <CommandList className="max-h-[400px] overflow-y-auto">
              <CommandEmpty>
                {query ? (loading ? '搜索中...' : '未找到匹配结果') : '开始输入以搜索...'}
              </CommandEmpty>

              {/* Search results - shown when there's a query */}
              {query && results.length > 0 && (
                <CommandGroup heading="搜索结果" className="text-xs">
                  {results.map((r) => {
                    const Icon = TYPE_ICONS[r.type]
                    const colorClass = TYPE_COLORS[r.type]
                    return (
                      <CommandItem
                        key={`${r.type}-${r.id}`}
                        onSelect={() => navigateTo(r.type === 'paper' ? 'papers' : r.type === 'topic' ? 'topics' : r.type === 'note' ? 'notes' : 'experiments')}
                        className="py-2 px-3 cursor-pointer"
                      >
                        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', colorClass)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 ml-2">
                          <div className="text-xs font-medium truncate">{r.title}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{r.subtitle}</div>
                        </div>
                        <span className="text-[9px] text-muted-foreground shrink-0 ml-2">
                          {TYPE_LABELS[r.type]}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}

              {/* Quick actions - shown when no query or as additional options */}
              {!query && (
                <>
                  <CommandGroup heading="快捷操作" className="text-xs">
                    {QUICK_ACTIONS.map((a) => {
                      const Icon = a.icon
                      return (
                        <CommandItem
                          key={a.id}
                          onSelect={() => navigateTo(a.section)}
                          className="py-2 px-3 cursor-pointer"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 min-w-0 ml-2">
                            <div className="text-xs font-medium">{a.label}</div>
                            <div className="text-[10px] text-muted-foreground">{a.desc}</div>
                          </div>
                          <CornerDownLeft className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>

                  <CommandSeparator />

                  <CommandGroup heading="导航到" className="text-xs">
                    {NAV_COMMANDS.map((n) => {
                      const Icon = n.icon
                      return (
                        <CommandItem
                          key={n.id}
                          onSelect={() => navigateTo(n.id)}
                          className="py-2 px-3 cursor-pointer"
                        >
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0 ml-2">
                            <div className="text-xs font-medium">{n.label}</div>
                          </div>
                          <span className="text-[9px] text-muted-foreground shrink-0">{n.desc}</span>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>

            {/* Footer */}
            <div className="border-t border-border px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">↑↓</kbd>
                  导航
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">↵</kbd>
                  选择
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px]">ESC</kbd>
                  关闭
                </span>
              </div>
              <span className="flex items-center gap-1">
                <CommandIcon className="h-2.5 w-2.5" />
                AI 通信组网科研助手
              </span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}
