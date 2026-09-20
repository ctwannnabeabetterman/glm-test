'use client'

import { useAppStore, type Section } from '@/lib/store'
import { AppearanceManager } from '@/components/appearance-manager'
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
  ChevronLeft,
  Network,
  Settings,
  HelpCircle,
  Command,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useState, useEffect, useRef } from 'react'
import { Toaster as SonnerToaster } from '@/components/ui/sonner'
import { CommandPalette } from '@/components/command-palette'
import { SidebarStats } from '@/components/sidebar-stats'
import { NotificationBell } from '@/components/notification-bell'
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts'
import { OnboardingTutorial } from '@/components/onboarding-tutorial'

/* 导航定义：中文为主标签，英文降级为 title 提示（学术工具不需要双行中英对照） */
const NAV_ITEMS: {
  id: Section
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  group: string
}[] = [
  { id: 'overview', label: '总览', hint: 'Overview', icon: LayoutDashboard, group: '概览' },
  { id: 'papers', label: '论文库', hint: 'Paper Library · Zotero', icon: BookOpen, group: '文献' },
  { id: 'search', label: '文献检索', hint: 'Keyword Matrix · arXiv', icon: Search, group: '文献' },
  { id: 'topics', label: '选题评估', hint: 'Topic Scorer', icon: Target, group: '研究' },
  { id: 'experiments', label: '实验管理', hint: 'Experiments & Baselines', icon: FlaskConical, group: '研究' },
  { id: 'planner', label: '研究规划', hint: 'Gantt · Timeline', icon: Calendar, group: '研究' },
  { id: 'simlab', label: '组网仿真', hint: 'Seeded · Reproducible', icon: Network, group: '研究' },
  { id: 'writing', label: '论文写作', hint: 'Structure · Phrases', icon: PenLine, group: '写作' },
  { id: 'notes', label: '科研笔记', hint: 'Obsidian-style Notes', icon: StickyNote, group: '写作' },
  { id: 'methodology', label: '方法论', hint: '6 Modules Guide', icon: GraduationCap, group: '写作' },
  { id: 'settings', label: '设置', hint: 'LLM API Key', icon: Settings, group: '系统' },
  { id: 'docs', label: '使用说明', hint: 'User Guide', icon: HelpCircle, group: '系统' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { activeSection, setSection, theme, toggleTheme, sidebarCollapsed } = useAppStore()
  const seededRef = useRef(false)
  const [seededToast, setSeededToast] = useState<string | null>(null)

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
            setSeededToast('已载入示例数据：论文 / 课题 / 实验 / 里程碑')
            setTimeout(() => setSeededToast(null), 4000)
          }
        })
        .catch(() => {})
    }
  }, [])

  const grouped = NAV_ITEMS.reduce<Record<string, typeof NAV_ITEMS>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {})

  const currentLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? '总览'

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppearanceManager />

      {/* ── 顶栏：克制的一行，不做渐变与发光 ───────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="flex h-12 items-center gap-4 px-5 lg:px-7">
          <div className="flex items-center gap-2.5">
            <Network className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} />
            <span className="font-serif text-[15px] font-semibold tracking-tight">
              AI Network Lab
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
              }
              className="hidden md:flex items-center gap-2 h-8 rounded-sm border border-border px-2.5 text-[12px] text-muted-foreground hover:border-border hover:bg-muted transition-colors"
              aria-label="搜索"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>搜索</span>
              <kbd className="ml-1 flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/70">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </button>
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-8 w-8"
              aria-label="切换主题"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Moon className="h-4 w-4" strokeWidth={1.75} />
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* ── 侧边栏：单行标签 + 大留白分组 ────────────────── */}
        <aside
          className={cn(
            'sticky top-12 hidden md:flex shrink-0 flex-col border-r border-border bg-sidebar/40 transition-all duration-200',
            sidebarCollapsed ? 'w-14' : 'w-[196px]'
          )}
          style={{ height: 'calc(100vh - 3rem)' }}
        >
          <nav className="flex-1 overflow-y-auto py-4 px-2.5">
            {Object.entries(grouped).map(([group, items], gi) => (
              <div key={group} className={gi > 0 ? 'mt-5' : ''}>
                {!sidebarCollapsed && <div className="px-2.5 mb-1.5 eyebrow">{group}</div>}
                {sidebarCollapsed && gi > 0 && <div className="mx-2 mb-2 rule" />}
                <div className="space-y-px">
                  {items.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSection === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSection(item.id)}
                        title={sidebarCollapsed ? item.label : item.hint}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-[7px] text-left transition-colors',
                          isActive
                            ? 'bg-sidebar-accent text-primary font-medium'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          sidebarCollapsed && 'justify-center px-0'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={isActive ? 2 : 1.75} />
                        {!sidebarCollapsed && <span className="text-[13px] truncate">{item.label}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>

          <SidebarStats collapsed={sidebarCollapsed} />

          <div className="border-t border-border p-2">
            <button
              onClick={() => useAppStore.getState().setSidebarCollapsed(!sidebarCollapsed)}
              className="flex w-full items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            >
              <ChevronLeft
                className={cn('h-3.5 w-3.5 transition-transform', sidebarCollapsed && 'rotate-180')}
                strokeWidth={1.75}
              />
              {!sidebarCollapsed && <span>收起</span>}
            </button>
          </div>
        </aside>

        {/* 移动端底部导航 */}
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
                    'flex flex-1 min-w-[60px] flex-col items-center gap-0.5 py-2 text-[10px]',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  <span className="truncate max-w-[56px]">{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* ── 主内容区 ──────────────────────────────────── */}
        <main className="flex-1 min-w-0 pb-16 md:pb-0">
          {/* 面包屑：给阅读一个"位置感" */}
          <div className="border-b border-border/60">
            <div className="mx-auto max-w-[1180px] px-6 lg:px-10 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>AI Network Lab</span>
                <span className="text-border">/</span>
                <span className="text-foreground">{currentLabel}</span>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[1180px] px-6 lg:px-10 py-7">
            <div key={activeSection} className="animate-fade-in">
              {children}
            </div>
          </div>
        </main>
      </div>

      {/* ── 页脚：一行元信息，不占视觉重量 ─────────────────── */}
      <footer className="mt-auto border-t border-border">
        <div className="mx-auto max-w-[1180px] px-6 lg:px-10 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>数据持久化于本地 SQLite</span>
          <span className="text-border">·</span>
          <span>方法论源：AI_Networking_Research_Methodology.md</span>
          <span className="ml-auto">MIT License</span>
        </div>
      </footer>

      {seededToast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-sm border border-border bg-card px-4 py-2 text-[13px] shadow-sm animate-fade-in">
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
