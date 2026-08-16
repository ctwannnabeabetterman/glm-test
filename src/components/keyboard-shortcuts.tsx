'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Keyboard, Command, ArrowUp, ArrowDown, CornerDownLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'

interface Shortcut {
  key: string
  desc: string
  category: string
  icon?: React.ComponentType<{ className?: string }>
}

const SHORTCUTS: Shortcut[] = [
  // Global
  { key: '⌘ K', desc: '打开命令面板 / 全局搜索', category: '全局', icon: Command },
  { key: '?', desc: '显示快捷键帮助', category: '全局', icon: Keyboard },
  { key: 'ESC', desc: '关闭对话框/面板', category: '全局', icon: X },

  // Navigation
  { key: 'G O', desc: '跳转到总览仪表盘', category: '导航' },
  { key: 'G P', desc: '跳转到论文库', category: '导航' },
  { key: 'G S', desc: '跳转到文献检索', category: '导航' },
  { key: 'G T', desc: '跳转到选题评估', category: '导航' },
  { key: 'G E', desc: '跳转到实验管理', category: '导航' },
  { key: 'G L', desc: '跳转到研究规划', category: '导航' },
  { key: 'G W', desc: '跳转到论文写作', category: '导航' },
  { key: 'G N', desc: '跳转到科研笔记', category: '导航' },
  { key: 'G M', desc: '跳转到方法论浏览', category: '导航' },

  // Command Palette
  { key: '↑ ↓', desc: '在命令面板中导航', category: '命令面板', icon: ArrowUp },
  { key: '↵', desc: '选择当前项', category: '命令面板', icon: CornerDownLeft },

  // Theme
  { key: '⌘ J', desc: '切换深色/浅色主题', category: '主题' },
]

const CATEGORY_ORDER = ['全局', '导航', '命令面板', '主题']

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false)
  const [pendingKeys, setPendingKeys] = useState<string[]>([])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ? key to open shortcuts
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement
        // Don't trigger when typing in input/textarea
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
        e.preventDefault()
        setOpen((o) => !o)
      }

      // G + letter for navigation (only when not typing)
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setPendingKeys(['g'])
        return
      }

      if (pendingKeys.length === 1 && pendingKeys[0] === 'g') {
        const navMap: Record<string, 'overview' | 'papers' | 'search' | 'topics' | 'experiments' | 'planner' | 'writing' | 'notes' | 'methodology'> = {
          o: 'overview',
          p: 'papers',
          s: 'search',
          t: 'topics',
          e: 'experiments',
          l: 'planner',
          w: 'writing',
          n: 'notes',
          m: 'methodology',
        }
        const section = navMap[e.key.toLowerCase()]
        if (section) {
          e.preventDefault()
          useAppStore.getState().setSection(section)
        }
        setPendingKeys([])
      }

      // Cmd+J for theme toggle
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        useAppStore.getState().toggleTheme()
      }
    }

    // Timeout to clear pending keys
    const timeout = setTimeout(() => {
      if (pendingKeys.length > 0) setPendingKeys([])
    }, 1000)

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearTimeout(timeout)
    }
  }, [pendingKeys])

  // Group shortcuts by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    shortcuts: SHORTCUTS.filter((s) => s.category === cat),
  })).filter((g) => g.shortcuts.length > 0)

  return (
    <>
      {/* Hidden trigger - can be activated via ? key */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-primary" />
              键盘快捷键
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {grouped.map((group) => (
              <div key={group.category}>
                <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                  {group.category}
                </div>
                <div className="space-y-1">
                  {group.shortcuts.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-md border border-border/40 p-2 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {s.icon && <s.icon className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="text-xs">{s.desc}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {s.key.split(' ').map((k, j) => (
                          <kbd
                            key={j}
                            className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded border border-border bg-muted text-[10px] font-mono font-medium"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-border pt-3 flex items-center justify-between">
            <div className="text-[10px] text-muted-foreground">
              💡 按 <kbd className="rounded border border-border bg-muted px-1 text-[9px]">?</kbd> 随时打开此帮助
            </div>
            <Badge variant="outline" className="text-[10px]">
              {SHORTCUTS.length} 个快捷键
            </Badge>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pending key indicator */}
      {pendingKeys.length > 0 && (
        <div className="fixed bottom-16 right-4 z-50 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary animate-fade-in">
          按 G + 字母导航...
        </div>
      )}
    </>
  )
}
