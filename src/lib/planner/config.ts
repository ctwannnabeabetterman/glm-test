/**
 * 研究规划的「项目级配置」—— 存 Setting KV（key = project.config）。
 *
 * 为什么必须有它：Gantt 里程碑的 startDate/endDate 存的是**周序号字符串**（"0".."39"），
 * 这是从方法论脚本集（gantt_chart.py 静态出图）直译过来的表示法。没有项目起始日时，
 * 「第 12 周」是个悬空概念 —— 既答不出是哪个月，也判断不了「现在落后没有」，
 * 40 周的甘特图因此失去规划意义。这里把起始日和每周可用工时补上。
 */

export const PROJECT_SETTING_KEY = 'project.config'

/** 周一 → 周日。默认来自方法论 §4.4.3 的 44h/周假设，允许用户改成自己的作息 */
export const DEFAULT_DAILY_HOURS: readonly number[] = [8, 8, 8, 8, 8, 4, 0]

export const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** 一天的可用工时上限（超过这个值的输入按脏数据兜底，而不是照单全收） */
export const MAX_DAILY_HOURS = 16

export interface ProjectConfig {
  /** 第 1 周（周序号 0）所在周的周一，YYYY-MM-DD；空串 = 未设置 */
  startDate: string
  /** 长度固定为 7 的每日可用工时 */
  dailyHours: number[]
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  startDate: '',
  dailyHours: [...DEFAULT_DAILY_HOURS],
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_RE.test(value)
}

/** 把任意输入归一化成合法的 ProjectConfig（脏数据一律退回默认值，不抛异常） */
export function normalizeProjectConfig(input: unknown): ProjectConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const startDate = isIsoDate(raw.startDate) ? raw.startDate : ''

  let dailyHours = [...DEFAULT_PROJECT_CONFIG.dailyHours]
  if (Array.isArray(raw.dailyHours) && raw.dailyHours.length === 7) {
    const parsed = raw.dailyHours.map((v) => Number(v))
    if (parsed.every((v) => Number.isFinite(v) && v >= 0 && v <= MAX_DAILY_HOURS)) {
      dailyHours = parsed
    }
  }

  return { startDate, dailyHours }
}

/** 一周可用总工时（周计划「本周可用」卡片与超时判定用） */
export function totalWeeklyHours(config: ProjectConfig): number {
  return config.dailyHours.reduce((sum, h) => sum + h, 0)
}

/** 是否已配置起始日 —— 未配置时甘特图只显示周序号，不显示日期 */
export function hasProjectStart(config: ProjectConfig): boolean {
  return isIsoDate(config.startDate)
}
