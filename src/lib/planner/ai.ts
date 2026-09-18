/**
 * AI 规划助手的纯逻辑（D4）。
 *
 * 拆成纯函数的原因和 `schedule.ts`/`linkage.ts` 一样：提示词里写了哪些约束、
 * 模型吐回来的脏数据怎么收拾，都是**可以被单测锁住**的东西。
 * 模型不会每次都听话，所以「解析失败怎么办」必须在这里定义清楚，
 * 而不是散在路由的 catch 里。
 */

import type { LlmMessage } from '@/lib/llm'
import { HEADING_LEVEL_RULE, OUTPUT_FORMAT_CONTRACT } from '@/lib/llm/format'
import { totalWeeklyHours, type ProjectConfig } from './config'
import { DEVIATION_STATE_LABELS, type Deviation, type MilestoneLike, plannedEndIso, plannedStartIso } from './linkage'
import { normalizeTaskInput, toLocalIsoDate, type WeeklyTaskInput } from './schedule'

// ============ 模式 ============

export type AssistMode = 'weekly' | 'risk' | 'breakdown'

export const ASSIST_MODES: readonly AssistMode[] = ['weekly', 'risk', 'breakdown']

export const ASSIST_MODE_LABELS: Record<AssistMode, string> = {
  weekly: '生成本周计划',
  risk: '进度风险体检',
  breakdown: '里程碑拆解',
}

/** AI 一次最多生成多少条任务 —— 防止模型吐 200 条把一周塞爆 */
export const MAX_PLAN_TASKS = 30

// ============ 上下文 ============

export interface AssistContext {
  projectConfig: ProjectConfig
  /** 目标周的周一 */
  weekStart: string
  /** 项目已进行到第几周（0-based）；项目未开始为负数，未设置起始日为 null */
  currentWeek: number | null
  milestones: MilestoneLike[]
  deviations: Deviation[]
  /** 目标周已有的任务，避免 AI 重复造一样的 */
  existingTasks: { name: string; hours: number; done: boolean }[]
  /** 用户额外补充的要求（可选） */
  goal?: string
  /** breakdown 模式指定的里程碑 */
  milestoneId?: string
}

interface MilestoneBrief {
  title: string
  kind: string
  plannedStart: string | null
  plannedEnd: string | null
  progress: number
  state: string
}

/**
 * 压扁成给模型看的紧凑结构。
 *
 * 为什么不直接把 Prisma 行丢进去：里程碑行上有一堆 UI 用的字段（color / category /
 * createdAt ...），既费 token 又容易把模型带偏。这里只留判断进度所需的字段。
 */
export function compactAssistContext(ctx: AssistContext): string {
  const { projectConfig, deviations } = ctx

  const deviationsById = new Map(deviations.map((d) => [d.id, d]))

  const milestones: MilestoneBrief[] = ctx.milestones.map((m) => {
    const dev = deviationsById.get(m.id)
    return {
      title: m.title,
      kind: m.type,
      plannedStart: plannedStartIso(m, projectConfig.startDate),
      plannedEnd: plannedEndIso(m, projectConfig.startDate),
      progress: m.progress,
      state: dev ? DEVIATION_STATE_LABELS[dev.state] : '未评估',
    }
  })

  const payload = {
    // 走本地日历，不用 toISOString —— 后者按 UTC 取日期，晚上跑会把「今天」写成明天
    today: toLocalIsoDate(new Date()),
    projectStart: projectConfig.startDate || '未设置',
    currentWeek: ctx.currentWeek === null ? '未知' : `第 ${ctx.currentWeek + 1} 周`,
    targetWeek: ctx.weekStart,
    weeklyCapacityHours: totalWeeklyHours(projectConfig),
    dailyCapacityHours: projectConfig.dailyHours,
    milestones,
    unfinishedThisWeek: ctx.existingTasks.filter((t) => !t.done),
    userGoal: ctx.goal || '',
  }
  return JSON.stringify(payload, null, 2)
}

/** 只有「未完成且能定位」的里程碑值得让 AI 拆解 */
export function breakdownCandidates(ctx: AssistContext): MilestoneLike[] {
  return ctx.milestones.filter((m) => m.progress < 100)
}

export function findBreakdownTarget(ctx: AssistContext): MilestoneLike | null {
  if (ctx.milestoneId) {
    const hit = ctx.milestones.find((m) => m.id === ctx.milestoneId)
    if (hit) return hit
  }
  return breakdownCandidates(ctx)[0] ?? null
}

// ============ 提示词 ============

const SYSTEM_BASE =
  '你是通信与智能网络方向研究生的科研进度规划助手。你只能依据用户提供的项目数据作答，' +
  '不得编造未提供的里程碑、论文或数据。所有输出必须是中文。'

/**
 * 只有 plan（纯文本）模式需要。
 *
 * weekly / breakdown 两种模式要求「只输出 JSON、不要 Markdown」—— 给它们再塞一份
 * Markdown 格式合同会直接自相矛盾，模型很可能就开始吐 ```json 代码块。
 * 所以格式合同必须按模式分开，见 tests/lib/planner-ai.test.ts 的断言。
 */
const SYSTEM_FORMAT_SUFFIX = `\n\n${OUTPUT_FORMAT_CONTRACT}\n${HEADING_LEVEL_RULE}`

/** weekly / breakdown 两种模式要求「机器可读」的输出，共用同一份格式约定 */
const JSON_FORMAT_RULE =
  '只输出一个 JSON 对象，不要输出任何解释文字、不要用 Markdown 代码块。格式：\n' +
  '{"tasks":[{"name":"任务名（具体到当天做完能打勾）","hours":1.5,"priority":1,"reason":"为什么这周做它"}]}\n' +
  '约束：priority 取 1-5 的整数（5 最紧急）；hours 取 0.5-8 之间的数；name 不超过 40 个字。'

export function buildAssistMessages(mode: AssistMode, ctx: AssistContext): LlmMessage[] {
  const context = compactAssistContext(ctx)

  if (mode === 'weekly') {
    const capacity = totalWeeklyHours(ctx.projectConfig)
    return [
      { role: 'system', content: `${SYSTEM_BASE}${SYSTEM_FORMAT_SUFFIX}你尤其擅长把模糊的研究目标拆成「一周内可执行、可判定完成」的任务清单。` },
      {
        role: 'user',
        content:
          `以下是我的研究项目当前状态：\n${context}\n\n` +
          `请为我生成 ${ctx.weekStart} 这一周的任务清单。要求：\n` +
          `1. 任务总工时**不得超过本周可用工时 ${capacity} 小时**（这是硬约束）；\n` +
          `2. 优先安排「落后」和「进行中」的里程碑，已完成的不再安排；\n` +
          `3. 不要与「本周已有任务」重复；\n` +
          `4. 任务要具体（例如「复现 XX 基线的随机路由实验并记录 PDR」，而不是「做实验」）；\n` +
          `5. 最多 ${MAX_PLAN_TASKS} 条，宁少勿滥。\n` +
          (ctx.goal ? `6. 我这周额外想做的事：${ctx.goal}\n` : '') +
          `\n${JSON_FORMAT_RULE}`,
      },
    ]
  }

  if (mode === 'breakdown') {
    const target = findBreakdownTarget(ctx)
    if (!target) {
      return [
        { role: 'system', content: SYSTEM_BASE },
        {
          role: 'user',
          content: `项目里没有未完成的里程碑，无需拆解。（上下文：${context}）`,
        },
      ]
    }
    const plannedEnd = plannedEndIso(target, ctx.projectConfig.startDate)
    return [
      { role: 'system', content: `${SYSTEM_BASE}你尤其擅长把一个里程碑拆成有先后依赖、可逐步交付的小任务。` },
      {
        role: 'user',
        content:
          `以下是我的研究项目当前状态：\n${context}\n\n` +
          `请把里程碑「${target.title}」拆解成可执行的任务（供我排进周计划）。\n` +
          `该里程碑当前进度 ${target.progress}%${plannedEnd ? `，计划 ${plannedEnd} 完成` : ''}。\n` +
          `要求：\n` +
          `1. 只拆解**尚未完成的那部分**，不要重复已经做完的工作；\n` +
          `2. 每条任务要能在几天内做完，体现先后依赖顺序；\n` +
          `3. 单条 hours 不超过 8，最多 ${MAX_PLAN_TASKS} 条；\n` +
          (ctx.goal ? `4. 补充要求：${ctx.goal}\n` : '') +
          `\n${JSON_FORMAT_RULE}`,
      },
    ]
  }

  return [
    { role: 'system', content: `${SYSTEM_BASE}${SYSTEM_FORMAT_SUFFIX}你尤其擅长做**进度评审**：从计划与实际的偏差里找出真正的风险，而不是罗列套话。` },
    {
      role: 'user',
      content:
        `以下是我的研究项目当前状态（含每个里程碑的计划/实际完成日与偏差判定）：\n${context}\n\n` +
        `请做一次进度风险体检，严格按以下结构输出 Markdown：\n` +
        `## 1. 总体判断\n用三句话说明：当前进度是否可控、最大的问题是什么。\n` +
        `## 2. 风险清单\n按「严重 → 轻微」列出，每条写：里程碑名、风险类型（进度/依赖/范围/资源）、证据（引用上面的日期或百分比）、后果。\n` +
        `## 3. 本周该优先做什么\n给出 3-5 条可立即执行的动作，并说明各自对应哪条风险。\n` +
        `## 4. 需要我来决定的事\n列出只有我能拍板的选择（例如砍范围 / 延期 / 换方案），并给出你的建议。\n\n` +
        `注意：如果数据不足以判断，直接写「数据不足」并说明缺什么，不要编造。`,
    },
  ]
}

// ============ 响应解析 ============

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 找到从 `start` 开始、括号配对的结束位置。
 * 必须跳过字符串字面量里的括号，否则 `{"name":"[实验 A]"}` 会被截在方括号上。
 */
function findBalancedEnd(text: string, start: number, open: string, close: string): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 从模型回复里抠出 JSON。
 *
 * 模型经常不听话：套一层 ```json 围栏、前面加一句「好的，这是任务：」、
 * 甚至只输出半个数组。这里逐级降级尝试，尽量把能用的东西捞出来。
 * 全部失败返回 null —— 由调用方决定怎么向用户交代（本项目不允许静默吞掉）。
 */
export function extractJsonBlock(text: unknown): unknown | null {
  if (typeof text !== 'string' || !text.trim()) return null

  // 去掉 Markdown 代码围栏，保留围栏内的内容
  const cleaned = text.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '').trim()

  const direct = tryParse(cleaned)
  if (direct !== null) return direct

  // 退一步：找一段配对的 [...] 或 {...}。
  // 必须**按出现位置**优先试最外层的那个括号：`{"tasks":[...]}` 里方括号虽然更"像数组"，
  // 但它在花括号内部 —— 先试 `[` 会把内层数组抠出来、丢掉外面的包装，
  // 于是 `{"tasks":[...]}` 被解析成裸数组（结果碰巧还能用，但语义已经错了）。
  const candidates: { start: number; open: string; close: string }[] = []
  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    const start = cleaned.indexOf(open)
    if (start >= 0) candidates.push({ start, open, close })
  }
  candidates.sort((a, b) => a.start - b.start)

  for (const candidate of candidates) {
    const end = findBalancedEnd(cleaned, candidate.start, candidate.open, candidate.close)
    if (end <= candidate.start) continue
    const parsed = tryParse(cleaned.slice(candidate.start, end + 1))
    if (parsed !== null) return parsed
  }
  return null
}

export interface ParsedPlan {
  tasks: WeeklyTaskInput[]
  /** 非 null 表示没能拿到可用任务，附带原因（给用户看，而不是静默返回空数组） */
  parseError: string | null
}

function pickTaskName(item: Record<string, unknown>): string {
  for (const key of ['name', 'title', 'task']) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * 把模型回复解析成**可直接入库**的周任务。
 *
 * 关键点：每条都过一遍 `normalizeTaskInput` —— 模型给出 `hours: 999` 或
 * `priority: 0` 时按脏数据截断，而不是把越界值写进库。
 * 名字缺失的条目直接丢弃（`normalizeTaskInput` 返回 null）。
 */
export function parseWeeklyPlan(text: unknown, weekStart: string): ParsedPlan {
  const block = extractJsonBlock(text)
  if (block === null) return { tasks: [], parseError: '未能从模型回复中解析出 JSON' }

  let rawList: unknown[] | null = null
  if (Array.isArray(block)) rawList = block
  else if (block && typeof block === 'object') {
    const holder = block as Record<string, unknown>
    for (const key of ['tasks', 'items', 'plan', 'list']) {
      if (Array.isArray(holder[key])) {
        rawList = holder[key] as unknown[]
        break
      }
    }
  }
  if (!rawList) return { tasks: [], parseError: 'JSON 里没有任务数组（期望 [...] 或 {"tasks":[...]}）' }

  const tasks: WeeklyTaskInput[] = []
  for (const item of rawList.slice(0, MAX_PLAN_TASKS)) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = pickTaskName(record)
    if (!name) continue
    const value = normalizeTaskInput(
      { name, hours: record.hours, priority: record.priority, weekStart, order: tasks.length },
      weekStart,
    )
    if (value) tasks.push({ ...value, order: tasks.length })
  }

  if (!tasks.length) return { tasks: [], parseError: '任务列表里没有可用条目（缺少 name 字段？）' }
  return { tasks, parseError: null }
}
