import { describe, expect, it } from 'vitest'
import {
  DEVIATION_STATE_LABELS,
  MANUSCRIPT_DRAFT_CAP,
  computeDeviation,
  countWords,
  deriveProgress,
  isPast,
  manuscriptWordCount,
  normalizeRefType,
  plannedEndIso,
  plannedStartIso,
  renderDeviationMarkdown,
  sortForDeviation,
  summarizeDeviation,
  syncedProgress,
  type Deviation,
  type MilestoneLike,
  type RefSnapshot,
} from '@/lib/planner/linkage'

// 2026-09-16 是周三
const NOW = new Date(2026, 8, 16)
/** 项目起始日故意选周一，方便用周序号直接推日期 */
const PROJECT_START = '2026-01-05'

function milestone(over: Partial<MilestoneLike> = {}): MilestoneLike {
  return {
    id: 'm1',
    type: 'gantt',
    title: '开题',
    startDate: '0',
    endDate: '0',
    progress: 0,
    ...over,
  }
}

const experiment = (status: string): RefSnapshot => ({
  type: 'experiment',
  item: { id: 'e1', name: '基线实验', status },
})

const manuscript = (over: Partial<{ status: string; targetWords: number; sections: string }> = {}): RefSnapshot => ({
  type: 'manuscript',
  item: {
    id: 'p1',
    title: '投稿稿',
    status: 'draft',
    targetWords: 1000,
    sections: '[]',
    ...over,
  },
})

/** 造 n 个中文字，方便凑出确定的字数 */
const cjk = (n: number) => '字'.repeat(n)

describe('关联类型', () => {
  it('只认实验与稿件两种，其余一律降级为空', () => {
    expect(normalizeRefType('experiment')).toBe('experiment')
    expect(normalizeRefType('manuscript')).toBe('manuscript')
    expect(normalizeRefType('note')).toBe('')
    expect(normalizeRefType(null)).toBe('')
    expect(normalizeRefType(3)).toBe('')
    expect(normalizeRefType('')).toBe('')
  })
})

describe('字数统计', () => {
  it('中文逐字、英文按空白分词', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('你好世界')).toBe(4)
    expect(countWords('hello world')).toBe(2)
    expect(countWords('你好 hello world')).toBe(4)
    expect(countWords('DeepSeek-V3 与 GPT')).toBe(3) // 与(1) + 两个拉丁词
  })

  it('纯符号与空白不产生字数', () => {
    expect(countWords('   ')).toBe(0)
    expect(countWords('!@#$%^&*()')).toBe(0)
  })

  it('稿件字数取各章节之和，脏数据静默为 0 而不是抛异常', () => {
    expect(manuscriptWordCount('[]')).toBe(0)
    expect(manuscriptWordCount('[{"content":"你好世界"}]')).toBe(4)
    expect(manuscriptWordCount('[{"content":"你好"},{"content":"abc def"}]')).toBe(4)
    expect(manuscriptWordCount('not json at all')).toBe(0)
    expect(manuscriptWordCount('{"a":1}')).toBe(0) // 合法 JSON 但不是数组
    expect(manuscriptWordCount('')).toBe(0)
    expect(manuscriptWordCount('[{"content":123}]')).toBe(0) // content 非字符串
  })
})

describe('进度派生', () => {
  it('实验状态映射成建议进度，未知状态返回 null（保持原值）', () => {
    expect(deriveProgress(experiment('planned'))).toBe(0)
    expect(deriveProgress(experiment('running'))).toBe(60)
    expect(deriveProgress(experiment('completed'))).toBe(100)
    // 失败不替用户宣布完成
    expect(deriveProgress(experiment('failed'))).toBe(0)
    expect(deriveProgress(experiment('archived'))).toBeNull()
  })

  it('没有快照时返回 null', () => {
    expect(deriveProgress(null)).toBeNull()
    expect(deriveProgress(undefined)).toBeNull()
  })

  it('稿件已投稿直接 100%，草稿按字数比例且封顶 95%', () => {
    expect(deriveProgress(manuscript({ status: 'submitted' }))).toBe(100)
    expect(deriveProgress(manuscript({ sections: JSON.stringify([{ content: cjk(500) }]) }))).toBe(50)
    // 目标字数缺失/非法 → 0，不能因为除零变成 NaN
    expect(deriveProgress(manuscript({ targetWords: 0 }))).toBe(0)
    expect(deriveProgress(manuscript({ targetWords: -10 }))).toBe(0)
    // 写超了也不给 100 —— 不投出去就没有「完成」
    expect(deriveProgress(manuscript({ sections: JSON.stringify([{ content: cjk(5000) }]) }))).toBe(MANUSCRIPT_DRAFT_CAP)
  })
})

describe('联动同步（只推进、不回退）', () => {
  it('默认关闭自动同步，手工填的进度不会被悄悄改掉', () => {
    const m = milestone({ progress: 30, refType: 'experiment', refId: 'e1', autoProgress: false })
    expect(syncedProgress(m, experiment('completed'))).toBeNull()
    // 连 autoProgress 字段都没有时同样不生效
    expect(syncedProgress(milestone({ refType: 'experiment', refId: 'e1' }), experiment('completed'))).toBeNull()
  })

  it('缺少合法关联时不同步', () => {
    expect(syncedProgress(milestone({ autoProgress: true }), experiment('completed'))).toBeNull()
    expect(syncedProgress(milestone({ autoProgress: true, refType: '', refId: 'e1' }), experiment('completed'))).toBeNull()
    expect(syncedProgress(milestone({ autoProgress: true, refType: 'experiment', refId: '' }), experiment('completed'))).toBeNull()
    expect(syncedProgress(milestone({ autoProgress: true, refType: 'bogus', refId: 'x' }), experiment('completed'))).toBeNull()
  })

  it('开启后按派生值推进', () => {
    const m = milestone({ progress: 30, refType: 'experiment', refId: 'e1', autoProgress: true })
    expect(syncedProgress(m, experiment('running'))).toBe(60)
    expect(syncedProgress(m, experiment('completed'))).toBe(100)
  })

  it('派生值低于当前进度时保持不变 —— 自动同步不该把进度拉低', () => {
    const m = milestone({ progress: 80, refType: 'experiment', refId: 'e1', autoProgress: true })
    expect(syncedProgress(m, experiment('running'))).toBe(80)
    expect(syncedProgress(m, experiment('planned'))).toBe(80)
  })

  it('稿件走同一条通道，投稿即 100', () => {
    const m = milestone({ progress: 0, refType: 'manuscript', refId: 'p1', autoProgress: true })
    expect(syncedProgress(m, manuscript({ status: 'submitted' }))).toBe(100)
    expect(syncedProgress(m, manuscript({ sections: JSON.stringify([{ content: cjk(500) }]) }))).toBe(50)
  })
})

describe('计划日期换算', () => {
  it('甘特图里程碑：周序号 + 项目起始日 → 真实日期', () => {
    expect(plannedStartIso(milestone({ startDate: '2' }), PROJECT_START)).toBe('2026-01-19')
    expect(plannedEndIso(milestone({ endDate: '3' }), PROJECT_START)).toBe('2026-02-01')
    expect(plannedEndIso(milestone({ endDate: '0' }), PROJECT_START)).toBe('2026-01-11')
  })

  it('甘特图缺周序号时返回 null，而不是硬算成第 1 周', () => {
    expect(plannedStartIso(milestone({ startDate: '' }), PROJECT_START)).toBeNull()
    expect(plannedStartIso(milestone({ startDate: 'abc' }), PROJECT_START)).toBeNull()
    expect(plannedEndIso(milestone({ endDate: '' }), PROJECT_START)).toBeNull()
  })

  it('非甘特类型按 ISO 日期读，非法日期返回 null', () => {
    const writing = milestone({ type: 'writing', startDate: '2026-03-01', endDate: '2026-03-10' })
    expect(plannedStartIso(writing, PROJECT_START)).toBe('2026-03-01')
    expect(plannedEndIso(writing, PROJECT_START)).toBe('2026-03-10')
    const broken = milestone({ type: 'writing', startDate: '3月1日', endDate: '' })
    expect(plannedStartIso(broken, PROJECT_START)).toBeNull()
    expect(plannedEndIso(broken, PROJECT_START)).toBeNull()
  })
})

describe('偏差复盘', () => {
  it('已完成：按实际完成日与计划结束日比出早晚', () => {
    const onTime = computeDeviation(
      milestone({ progress: 100, actualEndDate: '2026-01-11' }),
      PROJECT_START,
      NOW,
    )
    expect(onTime.state).toBe('on-time')
    expect(onTime.deviationDays).toBe(0)
    expect(onTime.plannedEnd).toBe('2026-01-11')

    const late = computeDeviation(milestone({ progress: 100, actualEndDate: '2026-01-14' }), PROJECT_START, NOW)
    expect(late.state).toBe('behind')
    expect(late.deviationDays).toBe(3)

    const early = computeDeviation(milestone({ progress: 100, actualEndDate: '2026-01-08' }), PROJECT_START, NOW)
    expect(early.state).toBe('ahead')
    expect(early.deviationDays).toBe(-3)
  })

  it('已完成但没有实际完成日 → 无法判定（不能假称按时）', () => {
    const row = computeDeviation(milestone({ progress: 100 }), PROJECT_START, NOW)
    expect(row.state).toBe('unknown')
    expect(row.deviationDays).toBeNull()
    expect(row.actualEnd).toBeNull()
  })

  it('未完成：计划结束日已过 → 落后 N 天', () => {
    const row = computeDeviation(milestone({ progress: 40, endDate: '1' }), PROJECT_START, NOW)
    expect(row.plannedEnd).toBe('2026-01-18')
    expect(row.state).toBe('behind')
    expect(row.deviationDays).toBe(241) // 2026-01-18 → 2026-09-16
  })

  it('未完成且计划结束日在今天或未来 → 进行中', () => {
    const today = computeDeviation(milestone({ progress: 40, endDate: '0' }), '2026-09-14', NOW)
    expect(today.plannedEnd).toBe('2026-09-20')
    expect(today.state).toBe('in-progress')
    expect(today.deviationDays).toBeNull()
  })

  it('没有计划结束日 → 无法判定', () => {
    const row = computeDeviation(milestone({ startDate: '', endDate: '' }), PROJECT_START, NOW)
    expect(row.plannedEnd).toBeNull()
    expect(row.state).toBe('unknown')
  })

  it('进度会被夹到 0-100，脏数据不会算出负偏差', () => {
    const row = computeDeviation(milestone({ progress: 150, actualEndDate: '2026-01-11' }), PROJECT_START, NOW)
    expect(row.progress).toBe(100)
    expect(row.state).toBe('on-time')
  })
})

describe('偏差汇总', () => {
  const rows: Deviation[] = [
    { id: 'a', title: 'A', type: 'gantt', progress: 100, plannedEnd: '2026-01-11', actualEnd: '2026-01-14', deviationDays: 3, state: 'behind' },
    { id: 'b', title: 'B', type: 'gantt', progress: 100, plannedEnd: '2026-02-01', actualEnd: '2026-02-01', deviationDays: 0, state: 'on-time' },
    { id: 'c', title: 'C', type: 'gantt', progress: 100, plannedEnd: '2026-03-01', actualEnd: '2026-02-26', deviationDays: -3, state: 'ahead' },
    { id: 'd', title: 'D', type: 'gantt', progress: 50, plannedEnd: '2026-12-01', actualEnd: null, deviationDays: null, state: 'in-progress' },
    { id: 'e', title: 'E', type: 'gantt', progress: 50, plannedEnd: null, actualEnd: null, deviationDays: null, state: 'unknown' },
  ]

  it('各状态计数与平均值只统计能算出来的行', () => {
    const s = summarizeDeviation(rows)
    expect(s.total).toBe(5)
    expect(s.done).toBe(3)
    expect(s.ahead).toBe(1)
    expect(s.onTime).toBe(1)
    expect(s.behind).toBe(1)
    expect(s.inProgress).toBe(1)
    expect(s.unknown).toBe(1)
    // (3 + 0 - 3) / 3 = 0
    expect(s.avgDeviationDays).toBe(0)
  })

  it('平均偏差保留 1 位小数，没有任何可算行时为 null', () => {
    const s = summarizeDeviation([
      ...rows,
      { id: 'f', title: 'F', type: 'gantt', progress: 100, plannedEnd: '2026-04-01', actualEnd: '2026-04-03', deviationDays: 2, state: 'behind' },
    ])
    // (3 + 0 - 3 + 2) / 4 = 0.5
    expect(s.avgDeviationDays).toBe(0.5)
    expect(summarizeDeviation([]).avgDeviationDays).toBeNull()
  })

  it('「最需要处理的」是偏差最大的 3 条', () => {
    // 可算偏差的是 a(+3) / b(0) / c(-3)，不足 3 条时全部保留并按偏差降序
    const s = summarizeDeviation(rows)
    expect(s.worst.map((w) => w.id)).toEqual(['a', 'b', 'c'])
    const many = summarizeDeviation([
      ...rows,
      { id: 'f', title: 'F', type: 'gantt', progress: 100, plannedEnd: '2026-04-01', actualEnd: '2026-04-09', deviationDays: 8, state: 'behind' },
      { id: 'g', title: 'G', type: 'gantt', progress: 100, plannedEnd: '2026-05-01', actualEnd: '2026-05-06', deviationDays: 5, state: 'behind' },
    ])
    expect(many.worst.map((w) => w.id)).toEqual(['f', 'g', 'a'])
  })
})

describe('偏差排序', () => {
  it('落后的排最前，按时/提前垫底', () => {
    const rows: Deviation[] = [
      { id: 'ahead', title: 'A', type: 'gantt', progress: 100, plannedEnd: '2026-01-01', actualEnd: '2026-01-01', deviationDays: -1, state: 'ahead' },
      { id: 'unknown', title: 'U', type: 'gantt', progress: 0, plannedEnd: null, actualEnd: null, deviationDays: null, state: 'unknown' },
      { id: 'behind', title: 'B', type: 'gantt', progress: 10, plannedEnd: '2026-01-01', actualEnd: null, deviationDays: 9, state: 'behind' },
      { id: 'progress', title: 'P', type: 'gantt', progress: 50, plannedEnd: '2026-12-01', actualEnd: null, deviationDays: null, state: 'in-progress' },
      { id: 'ontime', title: 'O', type: 'gantt', progress: 100, plannedEnd: '2026-01-01', actualEnd: '2026-01-01', deviationDays: 0, state: 'on-time' },
    ]
    expect(sortForDeviation(rows).map((r) => r.id)).toEqual(['behind', 'progress', 'unknown', 'ontime', 'ahead'])
  })
})

describe('偏差报告导出', () => {
  it('报告结构与页面口径一致，可直接贴给导师', () => {
    const rows = [computeDeviation(milestone({ progress: 100, actualEndDate: '2026-01-11' }), PROJECT_START, NOW)]
    const md = renderDeviationMarkdown(rows, summarizeDeviation(rows), {
      projectStart: PROJECT_START,
      generatedAt: NOW,
      projectName: '体素港口沙盒',
    })

    expect(md.startsWith('# 研究进度偏差报告\n')).toBe(true)
    expect(md.endsWith('\n')).toBe(true)
    expect(md).toContain('- 项目：体素港口沙盒')
    expect(md).toContain('- 项目起始日：2026-01-05')
    expect(md).toContain('- 生成时间：2026-09-16')
    expect(md).toContain('- 里程碑总数：1')
    expect(md).toContain('- 已完成：1（按时 1 · 提前 0 · 落后 0）')
    expect(md).toContain('- 平均偏差：0 天')
    // 数据行：标题 / 类型 / 进度 / 计划 / 实际 / 偏差 / 状态
    expect(md).toContain('| 开题 | gantt | 100% | 2026-01-11 | 2026-01-11 | 当天 | 按时完成 |')
  })

  it('未设置起始日、无法判定、没完成的极端行都不会渲染出 undefined/NaN', () => {
    const rows = [
      computeDeviation(milestone({ startDate: '', endDate: '', progress: 0 }), '', NOW),
      computeDeviation(milestone({ progress: 100, actualEndDate: '2026-01-14' }), PROJECT_START, NOW),
    ]
    const md = renderDeviationMarkdown(rows, summarizeDeviation(rows), {
      projectStart: '',
      generatedAt: NOW,
    })
    expect(md).toContain('- 项目起始日：未设置')
    expect(md).not.toContain('undefined')
    expect(md).not.toContain('NaN')
    expect(md).toContain('| — | — | — | 无法判定 |') // 缺计划/实际/偏差
    expect(md).toContain('晚 3 天')
  })

  it('没有可算的偏差时不出现「最需要处理的」小节', () => {
    const rows = [computeDeviation(milestone({ progress: 0, startDate: '', endDate: '' }), PROJECT_START, NOW)]
    const md = renderDeviationMarkdown(rows, summarizeDeviation(rows), { projectStart: PROJECT_START, generatedAt: NOW })
    expect(md).not.toContain('## 最需要处理的')
  })

  it('五种状态都有中文标签，导出里不会漏字', () => {
    const rows: Deviation[] = [
      { id: 'a', title: 'A', type: 'gantt', progress: 100, plannedEnd: '2026-01-01', actualEnd: '2025-12-30', deviationDays: -2, state: 'ahead' },
      { id: 'b', title: 'B', type: 'gantt', progress: 100, plannedEnd: '2026-01-01', actualEnd: '2026-01-01', deviationDays: 0, state: 'on-time' },
      { id: 'c', title: 'C', type: 'gantt', progress: 10, plannedEnd: '2026-01-01', actualEnd: null, deviationDays: 8, state: 'behind' },
      { id: 'd', title: 'D', type: 'gantt', progress: 50, plannedEnd: '2026-12-01', actualEnd: null, deviationDays: null, state: 'in-progress' },
      { id: 'e', title: 'E', type: 'gantt', progress: 0, plannedEnd: null, actualEnd: null, deviationDays: null, state: 'unknown' },
    ]
    const md = renderDeviationMarkdown(rows, summarizeDeviation(rows), { projectStart: PROJECT_START, generatedAt: NOW })
    for (const label of Object.values(DEVIATION_STATE_LABELS)) {
      expect(md).toContain(label)
    }
    expect(md).toContain('早 2 天')
  })
})

describe('日期是否已过', () => {
  it('按本地日历日比较，今天不算「已过」', () => {
    expect(isPast('2026-09-14', NOW)).toBe(true)
    expect(isPast('2026-09-16', NOW)).toBe(false)
    expect(isPast('2026-09-17', NOW)).toBe(false)
    expect(isPast('bad', NOW)).toBe(false)
    expect(isPast('', NOW)).toBe(false)
  })
})
