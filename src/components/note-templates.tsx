'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { FileText, ChevronDown, BookOpen, FlaskConical, Lightbulb, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface NoteTemplate {
  id: string
  name: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
  content: string
}

const TEMPLATES: NoteTemplate[] = [
  {
    id: 'paper-reading',
    name: '论文精读笔记',
    desc: '方法论 §2.3.2 三遍阅读法模板',
    icon: BookOpen,
    content: `# [论文标题]

## 元数据
- **作者**: 
- **年份**: 
- **期刊/会议**: 
- **DOI**: 
- **标签**: #DRL #资源分配

## 一句话概括


## 核心方法
- **方法1**: 
- **方法2**: 

## 关键公式
$$ $$

## 实验结果
- **数据集**: 
- **基线对比**: 方法A +3.2%, 方法B +1.5%

## 与我的课题关联
- **可借鉴**: 
- **可改进**: [[关联文献A]] 对比

## 疑问与思考
- ❓ 为什么这个方法在低SNR下失效？
- 💡 可以考虑叠加attention机制

## 三遍阅读记录
### 第一遍（快速筛选 5-10min）
- 研究什么问题: 
- 用了什么方法: 
- 结果如何: 
- 决策: 读/不读/搁置

### 第二遍（理解框架 30-60min）
- 动机: 
- 核心思想: 
- 实验设置: 

### 第三遍（深度复现 1-2h）
- 公式推导: 
- 代码实现: 
- 改进点: 
`,
  },
  {
    id: 'experiment-log',
    name: '实验记录卡',
    desc: '方法论 §3.3.1 实验记录规范',
    icon: FlaskConical,
    content: `# 实验记录: [实验名称]

## 基本信息
- **实验ID**: EXP_[日期]_[序号]
- **日期**: ${new Date().toISOString().slice(0, 10)}
- **项目**: 
- **课题**: 

## 超参数
- learning_rate = 0.001
- batch_size = 64
- hidden_dim = 128
- gamma = 0.99
- epsilon_start = 1.0 → epsilon_end = 0.01
- seed = 42

## 环境设置
- n_users = 4
- snr_db = 10
- channel_model = Rayleigh

## 训练日志
- Epoch 1/100: loss=2.34, reward=12.5
- Epoch 10/100: loss=0.87, reward=28.3
- Epoch 100/100: loss=0.12, reward=45.6

## 最终指标
- avg_throughput = 45.6 bps/Hz
- avg_delay = 2.3 ms
- convergence_epoch = 67

## 对比基线
- WMMSE: 32.1 bps/Hz ✓ 超出42%

## 备注
- 低SNR下性能不稳定，需要调整奖励函数
- 下一步尝试PPO替代DQN
`,
  },
  {
    id: 'idea-brainstorm',
    name: 'Idea 头脑风暴',
    desc: '记录研究灵感和想法',
    icon: Lightbulb,
    content: `# 💡 Idea: [想法标题]

## 背景灵感
- 来源论文: 
- 观察到的现象: 

## 核心想法
用一句话描述你的想法:

## 创新性分析
- **问题新**: 
- **方法新**: 
- **场景新**: 
- **组合新**: 

## 可行性评估
- 数据可得性: ⭐⭐⭐⭐⭐
- 基线可复现: ⭐⭐⭐⭐
- 计算资源: ⭐⭐⭐
- 个人能力: ⭐⭐⭐⭐

## 下一步行动
- [ ] 查阅相关文献 (5篇)
- [ ] 复现基线方法
- [ ] 设计实验方案
- [ ] 初步验证

## 相关论文
- [[论文1]]
- [[论文2]]
`,
  },
  {
    id: 'daily-log',
    name: '每日科研日志',
    desc: '记录每天科研进展',
    icon: Calendar,
    content: `# 📅 ${new Date().toISOString().slice(0, 10)} 科研日志

## 今日计划
- [ ] 阅读 2 篇论文
- [ ] 调试实验代码
- [ ] 写文献综述

## 今日完成
- ✅ 
- ✅ 

## 阅读记录
### 论文 1: [标题]
- 关键点: 
- 启发: 

### 论文 2: [标题]
- 关键点: 
- 启发: 

## 实验进展
- 

## 遇到的问题
- ❓ 
- 💡 解决方案: 

## 明日计划
- [ ] 
- [ ] 

## 思考与感悟


---
*本周累计阅读: X 篇*
*本周累计实验: X 次*
`,
  },
  {
    id: 'meeting-notes',
    name: '组会笔记',
    desc: '组会讨论记录',
    icon: FileText,
    content: `# 📝 组会笔记 ${new Date().toISOString().slice(0, 10)}

## 会议信息
- **时间**: 
- **地点**: 
- **参与人**: 
- **主讲人**: 

## 汇报内容
### 我的汇报
- 进展: 
- 问题: 
- 下一步: 

### 其他人汇报
- 

## 导师反馈
- 

## 讨论要点
1. 
2. 
3. 

## Action Items
- [ ] 我: 
- [ ] 同学A: 
- [ ] 导师: 

## 下次组会
- 时间: 
- 我的汇报内容: 
`,
  },
]

interface NoteTemplatesProps {
  onInsert: (content: string) => void
}

export function NoteTemplates({ onInsert }: NoteTemplatesProps) {
  const [recentTemplate, setRecentTemplate] = useState<string | null>(null)

  const handleInsert = (template: NoteTemplate) => {
    onInsert(template.content)
    setRecentTemplate(template.id)
    toast.success(`已插入「${template.name}」模板`)
    setTimeout(() => setRecentTemplate(null), 2000)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <FileText className="h-3 w-3 mr-1" />
          插入模板
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>选择笔记模板</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TEMPLATES.map((t) => {
          const Icon = t.icon
          return (
            <DropdownMenuItem
              key={t.id}
              onClick={() => handleInsert(t)}
              className={cn(
                'flex items-start gap-2 p-2 cursor-pointer',
                recentTemplate === t.id && 'bg-primary/10'
              )}
            >
              <div className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                recentTemplate === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              )}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">{t.name}</div>
                <div className="text-[10px] text-muted-foreground">{t.desc}</div>
              </div>
              {recentTemplate === t.id && (
                <Badge variant="secondary" className="text-[9px] bg-primary/15 text-primary">
                  ✓ 已插入
                </Badge>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
