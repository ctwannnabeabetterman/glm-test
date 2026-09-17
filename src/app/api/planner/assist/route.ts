import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatComplete, LlmNotConfiguredError, type LlmMessage } from '@/lib/llm'
import {
  ASSIST_MODES,
  buildAssistMessages,
  parseWeeklyPlan,
  type AssistContext,
  type AssistMode,
} from '@/lib/planner/ai'
import { computeDeviation, type Deviation, type MilestoneLike } from '@/lib/planner/linkage'
import { loadProjectConfig } from '@/lib/planner/server'
import { resolveWeekStart, weeksSince } from '@/lib/planner/schedule'

/**
 * POST /api/planner/assist —— AI 规划助手（D4）。
 *
 * 三种模式：
 *  - weekly    ：按当前进度与本周可用工时生成任务清单
 *  - risk      ：进度风险体检（Markdown 分析）
 *  - breakdown ：把指定里程碑拆成可执行任务
 *
 * **这个接口只生成、不写库**（刻意的）：
 * 写入由前端拿返回的 `tasks` 逐条调 `/api/weekly-tasks` 完成 —— 也就是「写进去的
 * 就是你看到的」。如果在这里顺手写库，用户点第二次「生成」会得到一份**不同**的计划，
 * 而库里已经躺了上一份，两边对不上，且没人能解释库里那些任务从哪来。
 * 副作用留在用户明确点击的那个动作上，AI 接口保持无副作用。
 *
 * 另一条刻意的设计：**解析失败返回 200 + `parseError` + 原文**，而不是 500 ——
 * 报错会把最有用的信息（模型到底说了什么）丢掉。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const mode = body.mode as AssistMode
    if (!ASSIST_MODES.includes(mode)) {
      // 与 notes / writing 导出、deviations 的约定一致：非法入参显式 400 并列出可选值
      return NextResponse.json({ error: `Unsupported mode: ${String(body.mode)}`, supported: ASSIST_MODES }, { status: 400 })
    }

    const projectConfig = await loadProjectConfig()
    const weekStart = resolveWeekStart(typeof body.weekStart === 'string' ? body.weekStart : null)
    const now = new Date()

    const [milestoneRows, existingRows] = await Promise.all([
      db.milestone.findMany(),
      db.weeklyTask.findMany({ where: { weekStart }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
    ])

    const milestones = milestoneRows as unknown as MilestoneLike[]
    const deviations: Deviation[] = milestones.map((m) => computeDeviation(m, projectConfig.startDate, now))

    const ctx: AssistContext = {
      projectConfig,
      weekStart,
      currentWeek: projectConfig.startDate ? weeksSince(projectConfig.startDate, now) : null,
      milestones,
      deviations,
      existingTasks: existingRows.map((t) => ({ name: t.name, hours: t.hours, done: t.done })),
      goal: typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : undefined,
      milestoneId: typeof body.milestoneId === 'string' && body.milestoneId ? body.milestoneId : undefined,
    }

    const messages: LlmMessage[] = buildAssistMessages(mode, ctx)

    let content: string
    try {
      content = await chatComplete(messages, { temperature: 0.5, maxTokens: 4000, timeoutMs: 180_000 })
    } catch (e) {
      if (e instanceof LlmNotConfiguredError) {
        // 401 会更像「鉴权失败」，但这里根本不是鉴权问题，而是功能前置条件没满足 ⇒ 400 + 可判定的 code
        return NextResponse.json({ error: e.message, code: 'LLM_NOT_CONFIGURED' }, { status: 400 })
      }
      const message = (e as Error).message
      console.error('planner assist llm error', e)
      return NextResponse.json({ error: `AI 规划失败：${message}`, code: 'LLM_CALL_FAILED' }, { status: 502 })
    }

    // risk 模式是纯分析，直接返回文本
    if (mode === 'risk') {
      return NextResponse.json({ success: true, mode, weekStart, content, tasks: [], parseError: null })
    }

    const { tasks, parseError } = parseWeeklyPlan(content, weekStart)

    return NextResponse.json({
      success: true,
      mode,
      weekStart,
      content,
      tasks,
      parseError,
    })
  } catch (e) {
    console.error('POST planner assist error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
