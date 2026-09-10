'use client'

import { useAppStore, type Section } from '@/lib/store'
import { ThemeManager } from '@/components/theme-manager'
import {
  LayoutDashboard,
  BookOpen,
  Search,
  Target,
  FlaskConical,
  Calendar,
  PenLine,
  StickyNote,
  GraduationCap,
  Moon,
  Sun,
  Wifi,
  ChevronLeft,
  Sparkles,
  Database,
  Network,
  Settings,
  HelpCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useState, useEffect, useRef } from 'react'
import { Toaster as SonnerToaster } from '@/components/ui/sonner'
import { CommandPalette } from '@/components/command-palette'
import { SidebarStats } from '@/components/sidebar-stats'
import { NotificationBell } from '@/components/notification-bell'
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts'
import { OnboardingTutorial } from '@/components/onboarding-tutorial'

const NAV_ITEMS: { id: Section; label: string; sublabel: string; icon: React.ComponentType<{ className?: string }>; group: string }[] = [
  { id: 'overview', label: '总览仪表盘', sublabel: 'Overview', icon: LayoutDashboard, group: '概览' },
  { id: 'papers', label: '论文库', sublabel: 'Paper Library · Zotero', icon: BookOpen, group: '文献与检索' },
  { id: 'search', label: '文献检索工具', sublabel: 'Keyword Matrix · arXiv', icon: Search, group: '文献与检索' },
  { id: 'topics', label: '选题评估', sublabel: 'Topic Scorer', icon: Target, group: '规划' },
  { id: 'experiments', label: '实验管理', sublabel: 'Experiments & Baselines', icon: FlaskConical, group: '规划' },
  { id: 'planner', label: '研究规划', sublabel: 'Gantt · Timeline', icon: Calendar, group: '规划' },
  { id: 'writing', label: '论文写作', sublabel: 'Structure · Phrases', icon: PenLine, group: '写作与投稿' },
  { id: 'notes', label: '科研笔记', sublabel: 'Obsidian-style Notes', icon: StickyNote, group: '写作与投稿' },
  { id: 'methodology', label: '方法论浏览', sublabel: '6 Modules Guide', icon: GraduationCap, group: '写作与投稿' },
  { id: 'simlab', label: '组网仿真实验', sublabel: 'Seeded · Reproducible', icon: Network, group: '仿真实验' },
  { id: 'inetlab', label: '智能组网实验室', sublabel: 'INET Scenarios', icon: Wifi, group: '仿真实验' },
  { id: 'settings', label: '系统设置', sublabel: 'LLM API Key', icon: Settings, group: '系统' },
  { id: 'docs', label: '使用说明', sublabel: 'User Guide · 文档', icon: HelpCircle, group: '系统' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { activeSection, setSection, theme, toggleTheme, sidebarCollapsed } = useAppStore()
  const seededRef = useRef(false)
  const [seededToast, setSeededToast] = useState<string | null>(null)

  // Auto seed on first visit (using ref to avoid setState in effect)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    const seeded = localStorage.getItem('ai-research-seeded')
    if (!seeded) {
      fetch('/api/seed', { method: 'POST' })
        .then((r) => r.json())
        .then((data) => {
          if (data?.success) {
            localStorage.setItem('ai-research-seeded', '1')
            setSeededToast('已自动播种示例数据：论文 / 课题 / 实验 / 里程碑')
            setTimeout(() => setSeededToast(null), 4000)
          }
        })
        .catch(() => {})
    }
  }, [])

  // Group nav items
  const grouped = NAV_ITEMS.reduce<Record<string, typeof NAV_ITEMS>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {})

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <ThemeManager />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
          <div className="flex items-center gap-2">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              <Wifi className="h-5 w-5" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 layer-pulse ring-2 ring-background" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold leading-tight">AI Network Lab</div>
              <div className="text-[10px] text-muted-foreground leading-tight">智能网络科研工作台 · v1.0</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="hidden md:flex gap-1.5 py-1 px-2.5 text-xs border-primary/30 text-primary">
              <Sparkles className="h-3 w-3" />
              基于 6 模块方法论
            </Badge>
            <button
              onClick={() => {
                // Trigger command palette via custom event
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
              }}
              className="hidden md:flex items-center gap-2 h-9 rounded-md border border-border bg-background/50 px-2.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
              aria-label="搜索"
            >
              <Search className="h-3.5 w-3.5" />
              <span>搜索...</span>
              <kbd className="flex items-center gap-0.5 rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-mono">
                <span className="text-[10px]">⌘</span>K
              </kbd>
            </button>
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-9 w-9"
              aria-label="切换主题"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <a
              href="https://github.com/ctwannnabeabetterman/glm-test"
              target="_blank"
              rel="noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
              aria-label="GitHub"
            >
              <Database className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside
          className={cn(
            'sticky top-14 hidden md:flex shrink-0 flex-col border-r border-border bg-sidebar/50 transition-all duration-200',
            sidebarCollapsed ? 'w-[60px]' : 'w-[240px]'
          )}
          style={{ height: 'calc(100vh - 3.5rem)' }}
        >
          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                {!sidebarCollapsed && (
                  <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </div>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSection === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSection(item.id)}
                        className={cn(
                          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all',
                          isActive
                            ? 'bg-primary/12 text-primary font-medium shadow-sm'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                          sidebarCollapsed && 'justify-center'
                        )}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                        {!sidebarCollapsed && (
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{item.label}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{item.sublabel}</div>
                          </div>
                        )}
                        {isActive && !sidebarCollapsed && (
                          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Quick stats in sidebar */}
          {!sidebarCollapsed && <SidebarStats collapsed={false} />}
          {sidebarCollapsed && <SidebarStats collapsed={true} />}

          <div className="border-t border-border p-2">
            <button
              onClick={() => useAppStore.getState().setSidebarCollapsed(!sidebarCollapsed)}
              className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform', sidebarCollapsed && 'rotate-180')} />
              {!sidebarCollapsed && <span>收起侧边栏</span>}
            </button>
          </div>
        </aside>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur">
          <div className="flex overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeSection === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    'flex flex-1 min-w-[64px] flex-col items-center gap-0.5 py-2 text-[10px]',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate max-w-[60px]">{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 min-w-0 pb-16 md:pb-0">
          <div className="mx-auto max-w-[1600px] p-4 lg:p-6">
            <div key={activeSection} className="animate-fade-in">
              {children}
            </div>
          </div>
        </main>
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-border bg-sidebar/30">
        <div className="mx-auto max-w-[1600px] px-4 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 layer-pulse" />
              系统运行正常
            </span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">数据持久化于 SQLite</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">方法论源：AI_Networking_Research_Methodology.md</span>
          </div>
          <div className="flex items-center gap-2">
            <span>© 2026 AI Network Lab · MIT License</span>
          </div>
        </div>
      </footer>

      {/* Seeded toast */}
      {seededToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary shadow-lg animate-fade-in">
          {seededToast}
        </div>
      )}

      <SonnerToaster />
      <CommandPalette />
      <KeyboardShortcuts />
      <OnboardingTutorial />
    </div>
  )
}
