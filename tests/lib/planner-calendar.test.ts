import { describe, expect, it } from 'vitest'
import {
  ICS_MAX_OCTETS,
  WEEKDAY_HEADERS,
  buildCalendarEvents,
  escapeIcsText,
  eventsByDate,
  expandEventIsoDates,
  foldIcsLine,
  icsFilename,
  monthMatrix,
  renderIcs,
  toIcsDate,
  toIcsStamp,
  type CalendarEvent,
} from '@/lib/planner/calendar'
import type { MilestoneLike } from '@/lib/planner/linkage'

const PROJECT_START = '2026-08-17' // 周一
const STAMP = new Date(Date.UTC(2026, 8, 16, 15, 30, 0))

const byteLen = (s: string) => Buffer.byteLength(s, 'utf8')

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

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'milestone-m1',
    title: '开题',
    kind: 'milestone',
    type: 'gantt',
    startDate: '2026-09-14',
    endDate: '2026-09-14',
    progress: 0,
    done: false,
    note: '进度 0%',
    ...over,
  }
}

const render = (events: CalendarEvent[], withAlarm?: boolean) =>
  renderIcs(events, { calendarName: 'AI Network Lab · 研究规划', generatedAt: STAMP, withAlarm })

/** 把折行还原成逻辑行，用来验证「折行没有丢字符」 */
function unfold(body: string): string[] {
  return body
    .split('\r\n')
    .filter((l) => l !== '')
    .reduce<string[]>((acc, line) => {
      if (line.startsWith(' ')) acc[acc.length - 1] += line.slice(1)
      else acc.push(line)
      return acc
    }, [])
}

describe('ICS 文本转义', () => {
  it('分号、逗号、换行都要转义', () => {
    expect(escapeIcsText('a;b,c')).toBe(String.raw`a\;b\,c`)
    expect(escapeIcsText('第一行\n第二行')).toBe(String.raw`第一行\n第二行`)
    expect(escapeIcsText('第一行\r\n第二行')).toBe(String.raw`第一行\n第二行`)
    expect(escapeIcsText('孤立回车\ra')).toBe(String.raw`孤立回车\na`)
  })

  it('反斜杠**先**转义，否则后面补的反斜杠会被再转一遍', () => {
    // 输入 a\;b → 若顺序反了会得到 a\\;b（分号没被转义）
    expect(escapeIcsText(String.raw`a\;b`)).toBe(String.raw`a\\\;b`)
    expect(escapeIcsText(String.raw`C:\path`)).toBe(String.raw`C:\\path`)
  })

  it('空值与非字符串不炸', () => {
    expect(escapeIcsText('')).toBe('')
    expect(escapeIcsText(null)).toBe('')
    expect(escapeIcsText(undefined)).toBe('')
    expect(escapeIcsText(123)).toBe('123')
  })
})

describe('ICS 折行（75 octets，按字节不是按字符）', () => {
  it('短行原样返回', () => {
    expect(foldIcsLine('SUMMARY:hello')).toBe('SUMMARY:hello')
    expect(foldIcsLine('')).toBe('')
  })

  it('长 ASCII 行在第 75 字节处折，续行以空格开头', () => {
    const folded = foldIcsLine('a'.repeat(100))
    const chunks = folded.split('\r\n')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(75)
    expect(chunks[1]).toBe(' ' + 'a'.repeat(25))
    expect(chunks[1]).toHaveLength(26)
  })

  it('中文按 3 字节算：一行最多 25 个汉字（不是 75 个）', () => {
    const folded = foldIcsLine('汉'.repeat(40))
    const chunks = folded.split('\r\n')
    expect(chunks[0]).toBe('汉'.repeat(25))
    expect(chunks[0]).toHaveLength(25)
    expect(byteLen(chunks[0])).toBe(75)
    expect(chunks[1]).toBe(' ' + '汉'.repeat(15))
    // 续行的空格也占额度：1 + 15*3 = 46 ≤ 75
    expect(byteLen(chunks[1])).toBeLessThanOrEqual(ICS_MAX_OCTETS)
  })

  it('绝不切断一个汉字 —— 折行后还原必须与原文完全一致', () => {
    const original = 'DESCRIPTION:' + '科研进度：完成基线路由实验与消融'.repeat(8)
    const folded = foldIcsLine(original)
    for (const chunk of folded.split('\r\n')) {
      expect(byteLen(chunk)).toBeLessThanOrEqual(ICS_MAX_OCTETS)
    }
    expect(unfold(folded + '\r\n').join('')).toBe(original)
  })

  it('恰好 75 字节时不折', () => {
    expect(foldIcsLine('x'.repeat(75))).toBe('x'.repeat(75))
  })
})

describe('ICS 日期', () => {
  it('YYYY-MM-DD → YYYYMMDD，非法日期返回 null', () => {
    expect(toIcsDate('2026-09-14')).toBe('20260914')
    expect(toIcsDate('2026-02-31')).toBeNull() // 格式对但日期不存在
    expect(toIcsDate('2026-9-4')).toBeNull()
    expect(toIcsDate('')).toBeNull()
  })

  it('DTSTAMP 必须是 UTC', () => {
    expect(toIcsStamp(new Date(Date.UTC(2026, 8, 16, 15, 30, 0)))).toBe('20260916T153000Z')
    expect(toIcsStamp(new Date(Date.UTC(2026, 0, 1, 0, 0, 5)))).toBe('20260101T000005Z')
  })

  it('文件名带日期', () => {
    expect(icsFilename(new Date(2026, 8, 16))).toBe('研究规划日历-2026-09-16.ics')
  })
})

describe('事件折算', () => {
  it('甘特里程碑：周序号按项目起始日换算成真实日期', () => {
    const events = buildCalendarEvents({ milestones: [milestone()], tasks: [], projectStart: PROJECT_START })
    expect(events).toHaveLength(1)
    expect(events[0].startDate).toBe('2026-08-17')
    expect(events[0].endDate).toBe('2026-09-06')
    expect(events[0].kind).toBe('milestone')
  })

  it('没设置起始日时甘特里程碑直接跳过，不猜日期', () => {
    expect(buildCalendarEvents({ milestones: [milestone()], tasks: [], projectStart: '' })).toEqual([])
  })

  it('写作/投稿里程碑按 ISO 日期读', () => {
    const events = buildCalendarEvents({
      milestones: [milestone({ type: 'submission', startDate: '2026-10-01', endDate: '2026-12-15' })],
      tasks: [],
      projectStart: '',
    })
    expect(events[0].startDate).toBe('2026-10-01')
    expect(events[0].endDate).toBe('2026-12-15')
  })

  it('已完成的里程碑标题带标记，note 里写上实际完成日', () => {
    const events = buildCalendarEvents({
      milestones: [milestone({ progress: 100, actualEndDate: '2026-09-05' })],
      tasks: [],
      projectStart: PROJECT_START,
    })
    expect(events[0].title).toBe('[已完成] 开题')
    expect(events[0].done).toBe(true)
    expect(events[0].note).toContain('实际完成于 2026-09-05')
  })

  it('结束日早于开始日的脏数据被丢掉，不生成倒着的区间', () => {
    const events = buildCalendarEvents({
      milestones: [milestone({ startDate: '5', endDate: '2' })],
      tasks: [],
      projectStart: PROJECT_START,
    })
    expect(events).toEqual([])
  })

  it('只有一端日期时按单日事件处理', () => {
    const events = buildCalendarEvents({
      milestones: [milestone({ type: 'writing', startDate: '2026-10-01', endDate: '' })],
      tasks: [],
      projectStart: '',
    })
    expect(events[0].startDate).toBe('2026-10-01')
    expect(events[0].endDate).toBe('2026-10-01')
  })

  it('周计划任务铺满整周（周一 ~ 周日）', () => {
    const events = buildCalendarEvents({
      milestones: [],
      tasks: [{ id: 't1', name: '读 3 篇论文', hours: 3, priority: 4, done: false, weekStart: '2026-09-14' }],
      projectStart: PROJECT_START,
    })
    expect(events[0].kind).toBe('task')
    expect(events[0].startDate).toBe('2026-09-14')
    expect(events[0].endDate).toBe('2026-09-20')
    expect(events[0].note).toBe('3 小时 · 优先级 4')
  })

  it('id 前缀区分里程碑与任务，保证 ICS 的 UID 不会撞车', () => {
    const events = buildCalendarEvents({
      milestones: [milestone({ id: 'same' })],
      tasks: [{ id: 'same', name: 't', hours: 1, priority: 1, done: false, weekStart: '2026-09-14' }],
      projectStart: PROJECT_START,
    })
    expect(events.map((e) => e.id)).toEqual(['milestone-same', 'task-same'])
  })
})

describe('事件展开与归档', () => {
  it('单日事件就一天', () => {
    expect(expandEventIsoDates(event())).toEqual(['2026-09-14'])
  })

  it('跨日事件覆盖含首尾的每一天', () => {
    expect(expandEventIsoDates(event({ startDate: '2026-09-14', endDate: '2026-09-17' }))).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
    ])
  })

  it('按日期归档，跨日事件在每一天都能查到', () => {
    const map = eventsByDate([event({ startDate: '2026-09-14', endDate: '2026-09-15' })])
    expect([...map.keys()]).toEqual(['2026-09-14', '2026-09-15'])
    expect(map.get('2026-09-15')).toHaveLength(1)
    expect(map.get('2026-09-16')).toBeUndefined()
  })
})

describe('月历网格', () => {
  it('表头是周一到周日（与周计划的周界一致）', () => {
    expect([...WEEKDAY_HEADERS]).toEqual(['一', '二', '三', '四', '五', '六', '日'])
  })

  it('6 行 × 7 列，且首格是本月 1 号所在周的周一', () => {
    const matrix = monthMatrix(2026, 9) // 2026-09-01 是周二 ⇒ 首格应为 08-31（周一）
    expect(matrix).toHaveLength(6)
    expect(matrix.every((row) => row.length === 7)).toBe(true)
    expect(matrix[0][0]).toEqual({ iso: '2026-08-31', inMonth: false })
    expect(matrix[0][1]).toEqual({ iso: '2026-09-01', inMonth: true })
    expect(matrix[5][6].iso).toBe('2026-10-11')
    expect(matrix.flat().filter((c) => c.inMonth)).toHaveLength(30) // 九月 30 天
  })

  it('1 号的星期决定前补几位', () => {
    const matrix = monthMatrix(2026, 2) // 2026-02-01 是周日 ⇒ 前补 6 位到 01-26
    expect(matrix[0][0].iso).toBe('2026-01-26')
    expect(matrix[0][6]).toEqual({ iso: '2026-02-01', inMonth: true })
  })

  it('非法月份返回空数组，不抛异常', () => {
    expect(monthMatrix(2026, 13)).toEqual([])
    expect(monthMatrix(2026, 0)).toEqual([])
    expect(monthMatrix(2026, 1.5)).toEqual([])
  })
})

describe('ICS 序列化', () => {
  it('换行一律 CRLF，且以 CRLF 收尾', () => {
    const body = render([event()])
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // 去掉所有 CRLF 后不该还剩裸 \n
    expect(body.replace(/\r\n/g, '')).not.toContain('\n')
    expect(body.replace(/\r\n/g, '')).not.toContain('\r')
  })

  it('必备头部齐全', () => {
    const body = render([event()])
    expect(body).toContain('VERSION:2.0')
    expect(body).toContain('PRODID:-//AI Network Lab//Research Planner//CN')
    expect(body).toContain('CALSCALE:GREGORIAN')
    expect(body).toContain('METHOD:PUBLISH')
    expect(body).toContain('X-WR-CALNAME:AI Network Lab · 研究规划')
  })

  it('全天事件的 DTEND 是**排他**的（结束日 + 1 天），否则最后一天会丢', () => {
    const single = render([event({ startDate: '2026-09-14', endDate: '2026-09-14' })])
    expect(single).toContain('DTSTART;VALUE=DATE:20260914')
    expect(single).toContain('DTEND;VALUE=DATE:20260915')

    const span = render([event({ startDate: '2026-09-01', endDate: '2026-09-03' })])
    expect(span).toContain('DTSTART;VALUE=DATE:20260901')
    expect(span).toContain('DTEND;VALUE=DATE:20260904')
  })

  it('每个事件一个 VEVENT，DTSTAMP 用生成时间', () => {
    const body = render([event({ id: 'a' }), event({ id: 'b' })])
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(body.match(/END:VEVENT/g)).toHaveLength(2)
    expect(body).toContain('DTSTAMP:20260916T153000Z')
  })

  it('UID 由稳定 id 派生 —— 重复导入是更新而不是堆重复项', () => {
    const a = render([event({ id: 'milestone-m1' })])
    const b = render([event({ id: 'milestone-m1' })])
    expect(a).toContain('UID:milestone-m1@ai-network-lab')
    expect(a.match(/UID:milestone-m1@ai-network-lab/g)).toHaveLength(1)
    expect(b).toContain('UID:milestone-m1@ai-network-lab')
  })

  it('未完成事件带「结束前 1 天」提醒；已完成的不提醒', () => {
    const pending = render([event({ done: false })])
    expect(pending).toContain('BEGIN:VALARM')
    expect(pending).toContain('ACTION:DISPLAY')
    // RELATED=END：相对结束时间，而不是默认的开始时间
    expect(pending).toContain('TRIGGER;RELATED=END:-P1D')
    expect(pending).toContain('END:VALARM')

    const done = render([event({ done: true, progress: 100, title: '[已完成] 开题' })])
    expect(done).not.toContain('BEGIN:VALARM')
  })

  it('可以整体关掉提醒', () => {
    expect(render([event()], false)).not.toContain('BEGIN:VALARM')
  })

  it('标题里的分号/逗号被转义，不会破坏 ICS 结构', () => {
    const body = render([event({ title: '实验；A, B' })])
    expect(unfold(body)).toContain(String.raw`SUMMARY:实验；A\, B`)
    // 全角分号不需要转义（RFC 只要求 ASCII ; , \）
    expect(body).not.toContain('SUMMARY:实验；A, B')
  })

  it('日期非法的条目被跳过，不产出残缺事件', () => {
    const body = render([event({ id: 'ok' }), event({ id: 'bad', startDate: 'not-a-date', endDate: '2026-09-14' })])
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(body).toContain('UID:ok@ai-network-lab')
    expect(body).not.toContain('UID:bad@')
  })

  it('没有任何事件时仍是合法的空日历', () => {
    const body = render([])
    expect(body).toBe(
      'BEGIN:VCALENDAR\r\n' +
        'VERSION:2.0\r\n' +
        'PRODID:-//AI Network Lab//Research Planner//CN\r\n' +
        'CALSCALE:GREGORIAN\r\n' +
        'METHOD:PUBLISH\r\n' +
        'X-WR-CALNAME:AI Network Lab · 研究规划\r\n' +
        'END:VCALENDAR\r\n',
    )
  })

  it('整份输出的每一物理行都不超过 75 octets（含中文长标题）', () => {
    const body = render([
      event({
        title: '完成基于深度强化学习的多跳无线网络路由与调度联合优化实验并整理消融结果',
        note: '进度 40% · 计划 2026-10-18 完成 · 依赖基线实验先跑通',
      }),
      event({ id: 'task-t1', title: '读 3 篇关于网络层拥塞控制的顶会论文并写一页综述笔记', kind: 'task', type: 'weekly' }),
    ])
    for (const line of body.split('\r\n')) {
      expect(byteLen(line)).toBeLessThanOrEqual(ICS_MAX_OCTETS)
    }
    // 折行后仍能还原出完整的标题
    expect(unfold(body).join('\n')).toContain('完成基于深度强化学习的多跳无线网络路由与调度联合优化实验并整理消融结果')
  })

  it('整理成日历条目时「页面看到的 == 导出的」（同一份事件对象）', () => {
    const events = buildCalendarEvents({
      milestones: [milestone({ id: 'x', title: '开题', progress: 0 })],
      tasks: [{ id: 't', name: '读论文', hours: 2, priority: 3, done: false, weekStart: '2026-09-14' }],
      projectStart: PROJECT_START,
    })
    const body = render(events)
    const lines = unfold(body)
    expect(lines).toContain('SUMMARY:开题')
    expect(lines).toContain('SUMMARY:读论文')
    expect(lines).toContain('UID:milestone-x@ai-network-lab')
    expect(lines).toContain('UID:task-t@ai-network-lab')
    expect(lines).toContain('CATEGORIES:研究里程碑')
    expect(lines).toContain('CATEGORIES:研究周计划')
    expect(lines).toContain('TRANSP:TRANSPARENT')
  })
})
