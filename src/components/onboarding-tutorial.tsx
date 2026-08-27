'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Sparkles, BookOpen, Search, Target, FlaskConical, Calendar,
  PenLine, StickyNote, GraduationCap, Command, ArrowRight, CheckCircle2,
  ChevronLeft, ChevronRight, X, ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'

interface TourStep {
  title: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  features: string[]
}

const TOUR_STEPS: TourStep[] = [
  {
    title: '欢迎使用 AI Network Lab',
    desc: '基于 6 模块方法论构建的一站式科研管理平台，覆盖从选题到投稿的全流程。',
    icon: Sparkles,
    color: 'text-primary bg-primary/10',
    features: ['9 大功能模块', '7 个 AI 驱动功能', '科研全流程管理'],
  },
  {
    title: '总览仪表盘',
    desc: '查看项目全局统计、三层架构图、阅读热力图、成就系统和个性化推荐。',
    icon: BookOpen,
    color: 'text-emerald-600 bg-emerald-500/10',
    features: ['三层架构可视化', '阅读活动热力图', '成就与徽章系统', '可自定义组件'],
  },
  {
    title: '论文库 + AI 助手',
    desc: 'Zotero 风格论文管理，支持三遍阅读法、AI 摘要、BibTeX 引用、引用追踪。',
    icon: Search,
    color: 'text-blue-600 bg-blue-500/10',
    features: ['三遍阅读法追踪', 'AI 论文摘要生成', 'BibTeX/CSV/EndNote 导出', '引用关系网络'],
  },
  {
    title: '文献检索 + AI 推荐',
    desc: '关键词矩阵、arXiv 监控、雪球法、全文搜索，以及 AI 驱动的研究方向推荐。',
    icon: Target,
    color: 'text-amber-600 bg-amber-500/10',
    features: ['3D 关键词矩阵', '实时 arXiv 搜索', 'AI 研究方向推荐', '对比表生成器'],
  },
  {
    title: '选题评估 + AI 分析',
    desc: '4 维加权打分矩阵，AI 研究空白分析、机会识别和综述框架生成。',
    icon: Target,
    color: 'text-purple-600 bg-purple-500/10',
    features: ['4 维量化打分', 'AI 研究空白分析', 'AI 研究机会推荐', '文献综述框架'],
  },
  {
    title: '实验管理 + AI 顾问',
    desc: '基线检查、超参数管理、消融实验，AI 实验设计顾问一键生成方案。',
    icon: FlaskConical,
    color: 'text-pink-600 bg-pink-500/10',
    features: ['3 层基线检查', '超参数网格', 'AI 实验设计顾问', '结果可视化模板'],
  },
  {
    title: '研究规划 + 写作',
    desc: 'Gantt 图、写作时间线、周计划、投稿追踪，AI 摘要生成器和文献综述。',
    icon: Calendar,
    color: 'text-cyan-600 bg-cyan-500/10',
    features: ['40 周 Gantt 图', '写作里程碑追踪', 'AI 摘要生成器', 'AI 文献综述'],
  },
  {
    title: '快捷键 + 命令面板',
    desc: '按 ⌘K 打开全局搜索，按 ? 查看所有快捷键，G+字母快速导航。',
    icon: Command,
    color: 'text-orange-600 bg-orange-500/10',
    features: ['⌘K 全局搜索', '? 快捷键帮助', 'G+字母导航', '⌘J 主题切换'],
  },
]

const STORAGE_KEY = 'onboarding-completed'

export function OnboardingTutorial() {
  const setSection = useAppStore((s) => s.setSection)
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return !localStorage.getItem(STORAGE_KEY)
  })
  const [step, setStep] = useState(0)

  useEffect(() => {
    // Mark as seen on mount (so it won't show again unless cleared)
    // The open state is initialized from localStorage
  }, [])

  const handleClose = () => {
    setOpen(false)
    localStorage.setItem(STORAGE_KEY, '1')
  }

  const handleSkip = () => {
    handleClose()
  }

  const handleNext = () => {
    if (step < TOUR_STEPS.length - 1) {
      setStep(step + 1)
    } else {
      handleClose()
    }
  }

  const handlePrev = () => {
    if (step > 0) {
      setStep(step - 1)
    }
  }

  const handleOpenDocs = () => {
    handleClose()
    // 切换到「使用说明」功能区，让用户直接阅读技术应用说明书
    setSection('docs')
  }

  const current = TOUR_STEPS[step]
  const Icon = current.icon
  const progress = ((step + 1) / TOUR_STEPS.length) * 100

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="sr-only">新手引导</DialogTitle>
            <button
              onClick={handleSkip}
              className="text-muted-foreground hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground">
              {step + 1} / {TOUR_STEPS.length}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {progress.toFixed(0)}%
            </span>
          </div>
          <Progress value={progress} className="h-1" />
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Icon */}
          <div className="flex justify-center">
            <div className={cn('flex h-16 w-16 items-center justify-center rounded-2xl', current.color)}>
              <Icon className="h-8 w-8" />
            </div>
          </div>

          {/* Title and description */}
          <div className="text-center space-y-2">
            <h2 className="text-lg font-bold">{current.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{current.desc}</p>
          </div>

          {/* Features */}
          <div className="grid grid-cols-1 gap-1.5">
            {current.features.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs">{f}</span>
              </div>
            ))}
          </div>

          {/* Step indicators */}
          <div className="flex items-center justify-center gap-1.5 py-1">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-muted'
                )}
              />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="flex items-center gap-1">
            {step === TOUR_STEPS.length - 1 && (
              <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={handleOpenDocs}>
                <BookOpen className="h-3.5 w-3.5 mr-1" />
                查看使用说明
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-xs" onClick={handleSkip}>
              跳过引导
            </Button>
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" size="sm" className="text-xs" onClick={handlePrev}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                上一步
              </Button>
            )}
            <Button size="sm" className="text-xs" onClick={handleNext}>
              {step === TOUR_STEPS.length - 1 ? (
                <>
                  开始使用
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </>
              ) : (
                <>
                  下一步
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
