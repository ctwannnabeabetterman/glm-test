import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'

/**
 * 使用记录（Activity）的契约。
 *
 * 三件事必须守住：
 *  ① **写入永不抛错** —— 记录是旁路。新表在未迁移的库上不存在（P2021），
 *     若在这里抛出去，用户的一次「保存笔记」就会因为他根本不知道的原因失败；
 *  ② **读取要优雅降级** —— 表还没建出来时给「重启客户端后会自动补上」的提示，而不是 500 红叉；
 *  ③ **每个模块都真的被接了线** —— 用户要的是「每个模块的使用都有记录」，
 *     漏接一个模块不会让任何测试变红，只会让时间线上少一块（所以用源码守卫钉住）。
 */

const dbMock = vi.hoisted(() => {
  const make = () => ({
    findMany: vi.fn(async () => [] as unknown[]),
    findUnique: vi.fn(async () => null as unknown),
    count: vi.fn(async () => 0),
    create: vi.fn(async (args: unknown) => args),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  })
  type Model = ReturnType<typeof make>
  const models: Record<string, Model> = {}
  const get = (key: string): Model => {
    if (!models[key]) models[key] = make()
    return models[key]
  }
  return { get, db: new Proxy({} as Record<string, Model>, { get: (_t, p) => get(String(p)) }) }
})

vi.mock('@/lib/db', () => ({ db: dbMock.db }))

const REPO = process.cwd()
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8')

// ⚠️ 每个用例前清掉调用记录：mock 的调用历史是跨用例累积的，
// 不清的话 `mock.calls[0]` 拿到的是**上一个用例**的那次调用（本轮就踩了：断言 where.module 得到 undefined）。
beforeEach(() => {
  dbMock.get('activity').findMany.mockClear()
  dbMock.get('activity').findMany.mockResolvedValue([])
})

describe('模块与动作的元数据', () => {
  it('每个模块都有中文标签与配色（时间线上的颜色/文字都靠它）', async () => {
    const { MODULE_META, moduleLabel, moduleColor } = await import('@/lib/activity')
    const ids = Object.keys(MODULE_META)
    expect(ids.length).toBeGreaterThanOrEqual(10)
    for (const id of ids) {
      expect(MODULE_META[id as keyof typeof MODULE_META].label.length).toBeGreaterThan(0)
      expect(MODULE_META[id as keyof typeof MODULE_META].color).toMatch(/^#[0-9a-f]{6}$/i)
    }
    // 未知模块不能崩，也不能显示成 undefined
    expect(moduleLabel('nope')).toBe('nope')
    expect(moduleColor('nope')).toMatch(/^#/)
  })

  it('标题会被压平并截断（时间线要一行读完）', async () => {
    const { clipTitle } = await import('@/lib/activity')
    expect(clipTitle('  多   余\n空白 ')).toBe('多 余 空白')
    expect(clipTitle('x'.repeat(200)).length).toBeLessThanOrEqual(60)
    expect(clipTitle('x'.repeat(200)).endsWith('…')).toBe(true)
  })
})

describe('recordActivity：旁路写入，永不抛错', () => {
  beforeEach(() => {
    for (const n of ['activity']) {
      dbMock.get(n).create.mockClear()
      dbMock.get(n).create.mockImplementation(async (args: unknown) => args)
      dbMock.get(n).count.mockResolvedValue(0)
    }
  })

  it('正常写入，并把标题截断后落库', async () => {
    const { recordActivity } = await import('@/lib/activity')
    const ok = await recordActivity({ module: 'note', action: 'create', title: '写了科研笔记「X」', refId: 'n1' })
    expect(ok).toBe(true)
    const data = (dbMock.get('activity').create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data
    expect(data).toMatchObject({ module: 'note', action: 'create', refId: 'n1' })
  })

  it('写库失败（例如表还没建出来）时返回 false 而**不抛出**', async () => {
    dbMock.get('activity').create.mockRejectedValueOnce(Object.assign(new Error('no such table: Activity'), { code: 'P2021' }))
    const { recordActivity } = await import('@/lib/activity')
    await expect(recordActivity({ module: 'paper', action: 'create', title: 'x' })).resolves.toBe(false)
  })

  it('清理函数同样不抛错（磁盘满 / 锁冲突都不该影响用户）', async () => {
    dbMock.get('activity').deleteMany.mockRejectedValueOnce(new Error('database is locked'))
    const { pruneActivities } = await import('@/lib/activity')
    await expect(pruneActivities()).resolves.toBeUndefined()
  })
})

describe('summarizeActivity：按天 + 按模块聚合', () => {
  const row = (date: Date, module: string, action = 'create', title = 't') => ({ createdAt: date, module, action, title })

  it('含空白天；按模块/动作计数；给当天最新 3 条预览', async () => {
    const { summarizeActivity } = await import('@/lib/activity')
    const now = new Date(2026, 8, 22, 20, 0, 0)
    const s = summarizeActivity(
      [
        row(new Date(2026, 8, 22, 9, 0), 'note', 'create', '写了笔记'),
        row(new Date(2026, 8, 22, 10, 0), 'note', 'update', '改了笔记'),
        row(new Date(2026, 8, 22, 11, 0), 'paper', 'generate', '生成了摘要'),
        row(new Date(2026, 8, 21, 9, 0), 'sim', 'run', '跑了仿真'),
      ],
      now,
      7,
    )
    expect(s.days).toHaveLength(7)
    expect(s.days[0].count).toBe(0) // 9-16 空白
    const today = s.days[6]
    expect(today.date).toBe('2026-09-22')
    expect(today.count).toBe(3)
    expect(today.byModule[0]).toMatchObject({ module: 'note', label: '科研笔记', count: 2 })
    expect(today.byAction.map((a) => a.action).sort()).toEqual(['create', 'generate', 'update'])
    expect(today.latest[0].title).toBe('生成了摘要') // 最新在前
    expect(today.latest[0].at).toBe('11:00')
    expect(s.totals).toEqual({ count: 4, activeDays: 2 })
    expect(s.busiest).toEqual({ date: '2026-09-22', count: 3 })
    expect(s.modules[0]).toMatchObject({ module: 'note', count: 2 })
  })

  it('窗口外的记录不计入；坏日期不会让某一天变 NaN', async () => {
    const { summarizeActivity } = await import('@/lib/activity')
    const now = new Date(2026, 8, 22, 12, 0, 0)
    const s = summarizeActivity(
      [
        { createdAt: 'not-a-date', module: 'note', action: 'create', title: 'x' },
        row(new Date(2026, 7, 1, 9, 0), 'note'),
        row(new Date(2026, 8, 22, 9, 0), 'paper'),
      ],
      now,
      7,
    )
    expect(s.totals.count).toBe(1)
    expect(s.totals.activeDays).toBe(1)
  })

  it('空的输入不崩、最忙的一天为 null', async () => {
    const { summarizeActivity } = await import('@/lib/activity')
    const s = summarizeActivity([], new Date(2026, 8, 22), 7)
    expect(s.totals).toEqual({ count: 0, activeDays: 0 })
    expect(s.busiest).toBeNull()
    expect(s.modules).toEqual([])
  })

  it('天数被夹紧到 1..90', async () => {
    const { summarizeActivity } = await import('@/lib/activity')
    const now = new Date(2026, 8, 22)
    expect(summarizeActivity([], now, 0).days).toHaveLength(1)
    expect(summarizeActivity([], now, 999).days).toHaveLength(90)
  })
})

describe('接口：读取要优雅降级', () => {
  it('/api/activity/recent 表不存在时返回 200 + unavailable（而不是 500 红叉）', async () => {
    dbMock.get('activity').findMany.mockRejectedValueOnce(new Error('no such table: main.Activity'))
    const { GET } = await import('@/app/api/activity/recent/route')
    const res = await GET(new NextRequest('http://localhost/api/activity/recent?days=7'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unavailable).toBe(true)
    expect(body.hint).toMatch(/重启客户端/)
    expect(body.days).toEqual([])
  })

  it('/api/activity/recent 正常时给出 7 天结构', async () => {
    dbMock.get('activity').findMany.mockResolvedValueOnce([
      { createdAt: new Date(), module: 'note', action: 'create', title: '写了笔记', refId: '', detail: '' },
    ])
    const { GET } = await import('@/app/api/activity/recent/route')
    const body = await (await GET(new NextRequest('http://localhost/api/activity/recent?days=7'))).json()
    expect(body.days).toHaveLength(7)
    expect(body.totals.count).toBe(1)
  })

  it('/api/activity 明细：接受 date / module，并带上中文标签', async () => {
    dbMock.get('activity').findMany.mockResolvedValueOnce([
      { id: 'a1', createdAt: new Date(), module: 'sim', action: 'run', title: '跑了一次仿真', refId: 'r1', detail: '' },
    ])
    const { GET } = await import('@/app/api/activity/route')
    const body = await (
      await GET(new NextRequest('http://localhost/api/activity?date=2026-09-22&module=sim&limit=50'))
    ).json()
    expect(body.items[0]).toMatchObject({ moduleLabel: '组网仿真', actionLabel: '运行' })
    // date 参数会转成「当天 0 点 ~ 次日 0 点」的区间
    const lastCall = dbMock.get('activity').findMany.mock.calls.at(-1) as unknown as [
      { where: { module?: string; createdAt: { gte: Date } } },
    ]
    const where = lastCall[0].where
    expect(where.module).toBe('sim')
    expect(where.createdAt.gte.getHours()).toBe(0)
  })

  it('/api/activity 明细同样降级（空列表 + unavailable）', async () => {
    dbMock.get('activity').findMany.mockRejectedValueOnce(new Error('no such table'))
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(new NextRequest('http://localhost/api/activity'))
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })
})

describe('源码守卫：每个模块都真的接了线', () => {
  const CASES: Array<[string, RegExp, string]> = [
    ['src/app/api/papers/route.ts', /action: 'create'/, '论文入库'],
    ['src/app/api/papers/[id]/route.ts', /action: 'delete'/, '论文删除'],
    ['src/app/api/notes/route.ts', /action: 'create'/, '写笔记'],
    ['src/app/api/notes/[id]/route.ts', /action: 'update'/, '改笔记'],
    ['src/app/api/ai-summary/route.ts', /module: 'paper', action: 'generate'/, '生成摘要'],
    ['src/app/api/ai-abstract/route.ts', /action: 'generate'/, 'AI 写摘要'],
    ['src/app/api/ai-review/route.ts', /action: 'generate'/, '综述草稿'],
    ['src/app/api/writing/manuscripts/route.ts', /module: 'writing'/, '新建稿件'],
    ['src/app/api/writing/manuscripts/[id]/route.ts', /action: 'update'/, '写稿件'],
    ['src/app/api/experiments/route.ts', /module: 'experiment'/, '实验记录'],
    ['src/app/api/topics/route.ts', /module: 'topic'/, '选题'],
    ['src/app/api/milestones/route.ts', /module: 'planner'/, '里程碑'],
    ['src/app/api/weekly-tasks/route.ts', /module: 'planner'/, '周计划'],
    ['src/app/api/sim/run/route.ts', /module: 'sim', action: 'run'/, '跑仿真'],
    ['src/app/api/sim/sweep/route.ts', /module: 'sim'[\s\S]{0,80}action: 'run'/, '参数扫描'],
    ['src/app/api/search-logs/route.ts', /module: 'search'/, '检索记录'],
    ['src/app/api/keywords/route.ts', /module: 'search'/, '关键词'],
    ['src/app/api/papers/apply-scores/route.ts', /action: 'update'/, '写回 AI 分数'],
  ]

  for (const [file, pattern, what] of CASES) {
    it(`${what} 会被记录（${file}）`, () => {
      const src = read(file)
      expect(src).toMatch(/import \{ recordActivity \} from '@\/lib\/activity'/)
      expect(src).toMatch(pattern)
    })
  }

  it('用 void 调用（不阻塞业务返回，也不产生未处理的 Promise）', () => {
    const src = read('src/app/api/notes/route.ts')
    expect(src).toMatch(/void recordActivity\(/)
  })

  it('概览页挂了「近 7 天使用记录」，且按惯例懒加载 recharts', () => {
    const overview = read('src/components/sections/overview-section.tsx')
    expect(overview).toMatch(/isVisible\('activity'\)/)
    expect(overview).toMatch(/import\('@\/components\/recent-activity-panel'\)/)
    const customizer = read('src/components/widget-customizer.tsx')
    expect(customizer).toMatch(/id: 'activity'/)
  })

  it('仿真页不再有「只属于仿真」的 7 天面板（已被全应用面板取代）', () => {
    const section = read('src/components/sections/sim-lab-section.tsx')
    expect(section).not.toMatch(/RecentRunsPanel/)
    expect(section).toMatch(/<SimSweepPanel/)
  })
})
