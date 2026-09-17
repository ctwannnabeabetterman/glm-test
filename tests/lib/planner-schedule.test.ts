import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  allocateWeeklyPlan,
  diffDaysIso,
  isoToMs,
  normalizeTaskInput,
  normalizeTaskPatch,
  parseWeekIndex,
  remainingHours,
  resolveWeekStart,
  sortByWeekIndex,
  startOfWeekFromIso,
  startOfWeekIso,
  toLocalIsoDate,
  weekEndIso,
  weekRangeLabel,
  weekStartIso,
  weeksSince,
} from '@/lib/planner/schedule'
import { DEFAULT_DAILY_HOURS, normalizeProjectConfig, totalWeeklyHours } from '@/lib/planner/config'

// 2026-09-16 是周三
const NOW = new Date(2026, 8, 16)

describe('日期换算', () => {
  it('只接受真实存在的 ISO 日期，格式对但日期不存在要挡掉', () => {
    expect(isoToMs('2026-09-16')).toBeTypeOf('number')
    expect(isoToMs('2026-02-31')).toBeNull()
    expect(isoToMs('2026-13-01')).toBeNull()
    expect(isoToMs('26-09-16')).toBeNull()
    expect(isoToMs('')).toBeNull()
  })

  it('加减天数能跨月跨年', () => {
    expect(addDaysIso('2026-12-30', 5)).toBe('2027-01-04')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysIso('bad', 1)).toBeNull()
  })

  it('天数差按 UTC 计算，不受本地时区影响', () => {
    expect(diffDaysIso('2026-09-16', '2026-09-14')).toBe(2)
    expect(diffDaysIso('2026-09-14', '2026-09-16')).toBe(-2)
    expect(diffDaysIso('2026-09-16', '2026-09-16')).toBe(0)
    expect(diffDaysIso('bad', '2026-09-16')).toBeNull()
  })

  it('一周之始是周一', () => {
    expect(startOfWeekIso(NOW)).toBe('2026-09-14') // 周三 → 本周一
    expect(startOfWeekIso(new Date(2026, 8, 14))).toBe('2026-09-14') // 周一 → 自己
    expect(startOfWeekIso(new Date(2026, 8, 20))).toBe('2026-09-14') // 周日 → 仍是本周一
    expect(startOfWeekFromIso('2026-09-20')).toBe('2026-09-14')
    expect(startOfWeekFromIso('nope')).toBeNull()
  })

  it('本地日期格式化不会把日期挪一天', () => {
    // 用 toISOString 会因时区偏移变成前一天，这里必须是本地日历日
    expect(toLocalIsoDate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(toLocalIsoDate(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31')
  })
})

describe('周序号', () => {
  it('空串不能被当成第 1 周', () => {
    expect(parseWeekIndex('')).toBeNull()
    expect(parseWeekIndex('  ')).toBeNull()
    expect(parseWeekIndex('abc')).toBeNull()
    expect(parseWeekIndex('-1')).toBeNull()
    expect(parseWeekIndex('3.5')).toBeNull()
    expect(parseWeekIndex('0')).toBe(0)
    expect(parseWeekIndex('39')).toBe(39)
    expect(parseWeekIndex(4)).toBe(4)
  })

  it('周序号能换算成真实日期区间（0-based）', () => {
    expect(weekStartIso('2026-01-05', 0)).toBe('2026-01-05')
    expect(weekEndIso('2026-01-05', 0)).toBe('2026-01-11')
    expect(weekStartIso('2026-01-05', 2)).toBe('2026-01-19')
    expect(weekRangeLabel('2026-01-05', 0, 0)).toBe('01-05 ~ 01-11')
    expect(weekRangeLabel('2026-01-05', 0, 3)).toBe('01-05 ~ 02-01')
    expect(weekStartIso('bad', 1)).toBeNull()
  })

  it('算出「当前第几周」，起始日之前为负', () => {
    expect(weeksSince('2026-01-05', new Date(2026, 0, 5))).toBe(0)
    expect(weeksSince('2026-01-05', new Date(2026, 0, 11))).toBe(0)
    expect(weeksSince('2026-01-05', new Date(2026, 0, 12))).toBe(1)
    expect(weeksSince('2026-01-05', new Date(2025, 11, 29))).toBe(-1)
    expect(weeksSince('', NOW)).toBeNull()
  })

  it('按数值排序，而不是字符串排序', () => {
    const input = [{ startDate: '10', endDate: '12' }, { startDate: '2', endDate: '5' }, { startDate: '0', endDate: '1' }]
    expect(sortByWeekIndex(input).map((m) => m.startDate)).toEqual(['0', '2', '10'])
    // 同起点时按结束周排
    const sameStart = [{ startDate: '3', endDate: '9' }, { startDate: '3', endDate: '4' }]
    expect(sortByWeekIndex(sameStart).map((m) => m.endDate)).toEqual(['4', '9'])
    // 非甘特数据（ISO 日期）保持字符串排序语义
    const iso = [{ startDate: '2026-10-01', endDate: '' }, { startDate: '2026-02-01', endDate: '' }]
    expect(sortByWeekIndex(iso).map((m) => m.startDate)).toEqual(['2026-02-01', '2026-10-01'])
  })
})

describe('按优先级分配周计划', () => {
  it('从周一开始填满每日工时，单任务可跨天拆分', () => {
    const days = allocateWeeklyPlan(
      [
        { name: 'A', hours: 10, priority: 5 },
        { name: 'B', hours: 8, priority: 5 },
        { name: 'C', hours: 5, priority: 1 },
      ],
      DEFAULT_DAILY_HOURS,
    )

    expect(days).toHaveLength(7)
    expect(days[0].items).toEqual([{ id: undefined, name: 'A', hours: 8, priority: 5 }])
    expect(days[1].items).toEqual([
      { id: undefined, name: 'A', hours: 2, priority: 5 },
      { id: undefined, name: 'B', hours: 6, priority: 5 },
    ])
    expect(days[2].items).toEqual([
      { id: undefined, name: 'B', hours: 2, priority: 5 },
      { id: undefined, name: 'C', hours: 5, priority: 1 },
    ])
    expect(days[3].items).toEqual([])
    // 周六 4h、周日 0h：总量刚好排完，不该再用到周末
    expect(days[5].items).toEqual([])
    expect(days[6].capacity).toBe(0)
  })

  it('已完成的任务不再占用计划，也不会被排进去', () => {
    const days = allocateWeeklyPlan(
      [
        { name: 'Done', hours: 8, priority: 5, done: true },
        { name: 'Todo', hours: 3, priority: 2 },
      ],
      DEFAULT_DAILY_HOURS,
    )
    expect(days[0].items).toEqual([{ id: undefined, name: 'Todo', hours: 3, priority: 2 }])
    expect(days.flatMap((d) => d.items).some((i) => i.name === 'Done')).toBe(false)
  })

  it('容量不足时排不下的部分被丢弃，而不是把工时堆到周日', () => {
    const days = allocateWeeklyPlan([{ name: 'Huge', hours: 100, priority: 5 }], DEFAULT_DAILY_HOURS)
    const placed = days.reduce((sum, d) => sum + d.items.reduce((s, i) => s + i.hours, 0), 0)
    expect(placed).toBe(totalWeeklyHours(normalizeProjectConfig({}))) // 44
    expect(days[6].items).toEqual([])
  })

  it('相同优先级按输入顺序稳定排序', () => {
    const days = allocateWeeklyPlan(
      [
        { name: 'First', hours: 2, priority: 3 },
        { name: 'Second', hours: 2, priority: 3 },
      ],
      DEFAULT_DAILY_HOURS,
    )
    expect(days[0].items.map((i) => i.name)).toEqual(['First', 'Second'])
  })

  it('剩余工时不统计已完成任务', () => {
    expect(
      remainingHours([
        { name: 'a', hours: 4, priority: 1 },
        { name: 'b', hours: 6, priority: 1, done: true },
      ]),
    ).toBe(4)
  })
})

describe('周计划入参归一化', () => {
  it('任务名为空直接拒绝', () => {
    expect(normalizeTaskInput({ name: '   ' }, '2026-09-14')).toBeNull()
    expect(normalizeTaskInput({}, '2026-09-14')).toBeNull()
    expect(normalizeTaskInput(null, '2026-09-14')).toBeNull()
  })

  it('越界数值截断而不是报错', () => {
    const value = normalizeTaskInput(
      { name: ' 读论文 ', hours: 99, priority: 9, weekStart: '2026-09-16' },
      '2026-09-14',
    )
    expect(value).toEqual({
      name: '读论文',
      hours: 24,
      priority: 5,
      done: false,
      weekStart: '2026-09-16',
      order: 0,
    })
  })

  it('非法周起始退回调用方给的默认周', () => {
    const value = normalizeTaskInput({ name: 'x', weekStart: 'not-a-date' }, '2026-09-14')
    expect(value?.weekStart).toBe('2026-09-14')
  })

  it('局部更新只接受白名单字段', () => {
    expect(normalizeTaskPatch({ done: true, hacked: 'boom', id: 'x' })).toEqual({ done: true })
    expect(normalizeTaskPatch({ name: '  ' })).toEqual({})
    expect(normalizeTaskPatch({ hours: -5 })).toEqual({ hours: 0 })
    expect(normalizeTaskPatch({ weekStart: 'nope' })).toEqual({})
  })

  it('周参数归一化到该周周一', () => {
    expect(resolveWeekStart('2026-09-16')).toBe('2026-09-14')
    expect(resolveWeekStart('2026-09-14')).toBe('2026-09-14')
    expect(resolveWeekStart(null)).toBe(startOfWeekIso(new Date()))
    expect(resolveWeekStart('garbage')).toBe(startOfWeekIso(new Date()))
  })
})

describe('项目配置', () => {
  it('脏数据一律退回默认值', () => {
    expect(normalizeProjectConfig(null).startDate).toBe('')
    expect(normalizeProjectConfig({ startDate: '2026-2-1' }).startDate).toBe('')
    expect(normalizeProjectConfig({ startDate: '2026-02-01' }).startDate).toBe('2026-02-01')
    expect(normalizeProjectConfig({ dailyHours: [1, 2, 3] }).dailyHours).toEqual([...DEFAULT_DAILY_HOURS])
    expect(normalizeProjectConfig({ dailyHours: [1, 2, 3, 4, 5, 6, 99] }).dailyHours).toEqual([...DEFAULT_DAILY_HOURS])
    expect(normalizeProjectConfig({ dailyHours: [1, 2, 3, 4, 5, 6, 7] }).dailyHours).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('周工时是每日之和', () => {
    expect(totalWeeklyHours(normalizeProjectConfig({}))).toBe(44)
    expect(totalWeeklyHours(normalizeProjectConfig({ dailyHours: [4, 4, 4, 4, 4, 0, 0] }))).toBe(20)
  })
})
