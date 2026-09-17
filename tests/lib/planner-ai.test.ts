import { describe, expect, it } from 'vitest'
import {
  ASSIST_MODES,
  MAX_PLAN_TASKS,
  breakdownCandidates,
  buildAssistMessages,
  compactAssistContext,
  extractJsonBlock,
  findBreakdownTarget,
  parseWeeklyPlan,
  type AssistContext,
} from '@/lib/planner/ai'
import { DEFAULT_PROJECT_CONFIG } from '@/lib/planner/config'
import { computeDeviation, type MilestoneLike } from '@/lib/planner/linkage'

const PROJECT_START = '2026-08-17'
const WEEK_START = '2026-09-14'
const NOW = new Date(2026, 8, 16)

function milestone(over: Partial<MilestoneLike> = {}): MilestoneLike {
  return {
    id: 'm1',
    type: 'gantt',
    title: '开题',
    startDate: '0',
    endDate: '2',
    progress: 0,
    ...over,
  }
}

function context(over: Partial<AssistContext> = {}): AssistContext {
  const milestones = over.milestones ?? [milestone()]
  const projectConfig = over.projectConfig ?? { ...DEFAULT_PROJECT_CONFIG, startDate: PROJECT_START }
  return {
    weekStart: WEEK_START,
    currentWeek: 4,
    existingTasks: [],
    ...over,
    projectConfig,
    milestones,
    deviations: over.deviations ?? milestones.map((m) => computeDeviation(m, projectConfig.startDate, NOW)),
  }
}

describe('模式定义', () => {
  it('三种模式齐全', () => {
    expect([...ASSIST_MODES]).toEqual(['weekly', 'risk', 'breakdown'])
  })
})

describe('上下文压扁', () => {
  it('只留判断进度需要的字段，日期已按项目起始日换算', () => {
    const raw = compactAssistContext(context())
    const parsed = JSON.parse(raw)
    expect(parsed.projectStart).toBe(PROJECT_START)
    expect(parsed.weeklyCapacityHours).toBe(44)
    expect(parsed.targetWeek).toBe(WEEK_START)
    expect(parsed.milestones[0]).toEqual({
      title: '开题',
      kind: 'gantt',
      plannedStart: '2026-08-17',
      plannedEnd: '2026-09-06',
      progress: 0,
      state: '落后',
    })
    // UI 专用字段不该进提示词
    expect(raw).not.toContain('color')
    expect(raw).not.toContain('createdAt')
  })

  it('未设置起始日时不假造日期', () => {
    const parsed = JSON.parse(
      compactAssistContext(
        context({ projectConfig: { ...DEFAULT_PROJECT_CONFIG }, currentWeek: null }),
      ),
    )
    expect(parsed.projectStart).toBe('未设置')
    expect(parsed.currentWeek).toBe('未知')
    expect(parsed.milestones[0].plannedStart).toBeNull()
  })

  it('带上本周未完成任务与用户补充要求', () => {
    const parsed = JSON.parse(
      compactAssistContext(
        context({
          existingTasks: [
            { name: '已做完的', hours: 2, done: true },
            { name: '还没做的', hours: 3, done: false },
          ],
          goal: '准备组会汇报',
        }),
      ),
    )
    expect(parsed.unfinishedThisWeek).toEqual([{ name: '还没做的', hours: 3, done: false }])
    expect(parsed.userGoal).toBe('准备组会汇报')
  })
})

describe('提示词', () => {
  it('weekly：硬约束里写明本周可用工时，并要求机器可读输出', () => {
    const messages = buildAssistMessages('weekly', context())
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    const user = messages[1].content
    expect(user).toContain('不得超过本周可用工时 44 小时')
    expect(user).toContain('{"tasks"')
    expect(user).toContain('priority 取 1-5')
    // 不允许模型自由发挥成 Markdown
    expect(user).toContain('不要用 Markdown 代码块')
  })

  it('weekly：把用户补充要求写进去（没有就不出现该条）', () => {
    expect(buildAssistMessages('weekly', context({ goal: '写中期报告' }))[1].content).toContain('写中期报告')
    expect(buildAssistMessages('weekly', context())[1].content).not.toContain('我这周额外想做的事')
  })

  it('risk：要求 Markdown 结构，且不许编造', () => {
    const messages = buildAssistMessages('risk', context())
    const user = messages[1].content
    expect(user).toContain('## 1. 总体判断')
    expect(user).toContain('## 4. 需要我来决定的事')
    expect(user).toContain('不要编造')
    // risk 不需要 JSON 约定
    expect(user).not.toContain('{"tasks"')
  })

  it('breakdown：点名要拆的里程碑，并只拆未完成的部分', () => {
    const target = milestone({ id: 'ms-x', title: '完成基线路由实验', progress: 40, endDate: '8' })
    const messages = buildAssistMessages('breakdown', context({ milestones: [target], milestoneId: 'ms-x' }))
    const user = messages[1].content
    expect(user).toContain('完成基线路由实验')
    expect(user).toContain('当前进度 40%')
    expect(user).toContain('2026-10-18') // 第 8 周结束日（2026-08-17 起算）
    expect(user).toContain('只拆解**尚未完成的那部分**')
  })

  it('breakdown：没有未完成里程碑时明确说明，而不是硬编一个', () => {
    const done = milestone({ progress: 100 })
    const messages = buildAssistMessages('breakdown', context({ milestones: [done] }))
    expect(messages[1].content).toContain('没有未完成的里程碑')
  })

  it('系统提示统一要求只用本地数据、输出中文', () => {
    for (const mode of ASSIST_MODES) {
      const system = buildAssistMessages(mode, context())[0].content
      expect(system).toContain('不得编造')
      expect(system).toContain('中文')
    }
  })
})

describe('拆解目标选择', () => {
  it('未完成的才作为候选', () => {
    const list = [
      milestone({ id: 'a', progress: 100 }),
      milestone({ id: 'b', progress: 30 }),
      milestone({ id: 'c', progress: 0 }),
    ]
    expect(breakdownCandidates(context({ milestones: list })).map((m) => m.id)).toEqual(['b', 'c'])
  })

  it('指定 id 优先，找不到才退回第一个未完成的', () => {
    const list = [milestone({ id: 'a', progress: 30 }), milestone({ id: 'b', progress: 10 })]
    expect(findBreakdownTarget(context({ milestones: list, milestoneId: 'b' }))?.id).toBe('b')
    expect(findBreakdownTarget(context({ milestones: list, milestoneId: 'nope' }))?.id).toBe('a')
    expect(findBreakdownTarget(context({ milestones: [milestone({ progress: 100 })] }))).toBeNull()
  })
})

describe('JSON 抽取（模型经常不听话）', () => {
  it('纯 JSON 直接解析', () => {
    expect(extractJsonBlock('{"tasks":[]}')).toEqual({ tasks: [] })
    expect(extractJsonBlock('[{"name":"a"}]')).toEqual([{ name: 'a' }])
  })

  it('剥掉 Markdown 代码围栏', () => {
    expect(extractJsonBlock('```json\n{"tasks":[{"name":"a"}]}\n```')).toEqual({ tasks: [{ name: 'a' }] })
    expect(extractJsonBlock('```\n[{"name":"a"}]\n```')).toEqual([{ name: 'a' }])
  })

  it('前后有废话也能抠出来', () => {
    expect(extractJsonBlock('好的，这是本周计划：\n[{"name":"a"}]\n希望有帮助！')).toEqual([{ name: 'a' }])
    expect(extractJsonBlock('以下 JSON：\n```json\n{"tasks":[{"name":"a"}]}\n```\n以上。')).toEqual({
      tasks: [{ name: 'a' }],
    })
  })

  it('字符串里含方括号/花括号不会把数组截断', () => {
    expect(extractJsonBlock('[{"name":"跑 [实验 A] 的 {基线}"}]')).toEqual([{ name: '跑 [实验 A] 的 {基线}' }])
  })

  it('转义引号不会误判字符串结束', () => {
    expect(extractJsonBlock('[{"name":"引号 \\" 里的 ] 括号"}]')).toEqual([{ name: '引号 " 里的 ] 括号' }])
  })

  it('彻底不是 JSON 时返回 null，不抛异常', () => {
    expect(extractJsonBlock('模型今天不想干活')).toBeNull()
    expect(extractJsonBlock('{坏掉的')).toBeNull()
    expect(extractJsonBlock('')).toBeNull()
    expect(extractJsonBlock(null)).toBeNull()
    expect(extractJsonBlock(undefined)).toBeNull()
    expect(extractJsonBlock(123)).toBeNull()
  })
})

describe('周计划解析与清洗', () => {
  it('数组形式：逐条归一化，order 按顺序落', () => {
    const { tasks, parseError } = parseWeeklyPlan(
      '[{"name":"读 3 篇路由论文","hours":3,"priority":4},{"name":"跑基线","hours":5}]',
      WEEK_START,
    )
    expect(parseError).toBeNull()
    expect(tasks).toEqual([
      { name: '读 3 篇路由论文', hours: 3, priority: 4, done: false, weekStart: WEEK_START, order: 0 },
      { name: '跑基线', hours: 5, priority: 3, done: false, weekStart: WEEK_START, order: 1 },
    ])
  })

  it('对象形式（tasks / items）都能接住', () => {
    expect(parseWeeklyPlan('{"tasks":[{"name":"a"}]}', WEEK_START).tasks[0].name).toBe('a')
    expect(parseWeeklyPlan('{"items":[{"name":"b"}]}', WEEK_START).tasks[0].name).toBe('b')
  })

  it('越界数值按脏数据截断，而不是把 999 小时写进库', () => {
    const { tasks } = parseWeeklyPlan('[{"name":"离谱任务","hours":999,"priority":99}]', WEEK_START)
    expect(tasks[0].hours).toBe(24)
    expect(tasks[0].priority).toBe(5)
    const { tasks: low } = parseWeeklyPlan('[{"name":"低优先级","priority":0}]', WEEK_START)
    expect(low[0].priority).toBe(1)
  })

  it('缺 name 的条目直接丢弃（title 可作为替代字段）', () => {
    const { tasks } = parseWeeklyPlan('[{"hours":3},{"title":"用 title 当名字"},{"name":"   "}]', WEEK_START)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('用 title 当名字')
  })

  it('名字首尾空格被清掉', () => {
    expect(parseWeeklyPlan('[{"name":"  写引言  "}]', WEEK_START).tasks[0].name).toBe('写引言')
  })

  it('条数上限，防止模型吐 200 条把一周塞爆', () => {
    const many = JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ name: `任务${i}` })))
    const { tasks } = parseWeeklyPlan(many, WEEK_START)
    expect(tasks).toHaveLength(MAX_PLAN_TASKS)
    expect(tasks[MAX_PLAN_TASKS - 1].order).toBe(MAX_PLAN_TASKS - 1)
  })

  it('解析不出来时给明确原因，不是静默空数组', () => {
    expect(parseWeeklyPlan('我不想输出 JSON', WEEK_START).parseError).toContain('未能')
    expect(parseWeeklyPlan('{"foo":1}', WEEK_START).parseError).toContain('没有任务数组')
    expect(parseWeeklyPlan('[{"hours":3}]', WEEK_START).parseError).toContain('没有可用条目')
    // 前两种情况下 tasks 必须为空，调用方据此不写库
    expect(parseWeeklyPlan('我不想输出 JSON', WEEK_START).tasks).toEqual([])
  })

  it('围栏包裹的回复同样能入库', () => {
    const { tasks, parseError } = parseWeeklyPlan('```json\n[{"name":"a","hours":2}]\n```', WEEK_START)
    expect(parseError).toBeNull()
    expect(tasks).toHaveLength(1)
  })

  it('weekStart 一律用调用方给的周，忽略模型瞎填的日期', () => {
    const { tasks } = parseWeeklyPlan('[{"name":"a","weekStart":"1999-01-01"}]', WEEK_START)
    expect(tasks[0].weekStart).toBe(WEEK_START)
  })
})
