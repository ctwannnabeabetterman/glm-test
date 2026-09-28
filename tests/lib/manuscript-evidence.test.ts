import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildManuscriptEvidence } from '@/lib/writing/resolve'

/**
 * 「引文 → 阅读证据」—— 方向 A（可追溯的科研证据链）的第一小步，2026-09-28。
 *
 * 立这条线的理由：稿件里的 `[@paperId]` 过去只能证明「库里存在这条题录」，
 * 证明不了「你读过它」。而「引用了一篇自己没读过的文献」正是投稿后最难解释的情况。
 * 证据算错的方向有两种，都比不显示更糟：
 *  - **多算**（把没读过的说成读过）⇒ 用户以为没问题，事故照样发生；
 *  - **少算**（把已读的说成未读）⇒ 满屏误报，用户从此不看这个提示。
 */

const P = (id: string, over: Partial<{ status: string | null; readingTime: number | null }> = {}) => ({
  id,
  status: 'read',
  readingTime: 600,
  ...over,
})

describe('buildManuscriptEvidence：阅读状态与痕迹', () => {
  it('笔记数按 paperIds 反查，且只数本稿件引用到的那几篇', () => {
    const rows = buildManuscriptEvidence(
      ['p1', 'p2'],
      [P('p1'), P('p2')],
      [
        { paperIds: '["p1"]' },
        { paperIds: '["p1","p2"]' }, // 一条笔记可以同时挂多篇
        { paperIds: '["p9"]' },      // 与本稿件无关，不许算进来
      ],
      [],
    )
    expect(rows.find((r) => r.paperId === 'p1')?.linkedNotes).toBe(2)
    expect(rows.find((r) => r.paperId === 'p2')?.linkedNotes).toBe(1)
  })

  it('引用关系两端都算（这篇引别人、被别人引都是库内已建立的关系）', () => {
    const rows = buildManuscriptEvidence(
      ['p1'],
      [P('p1')],
      [],
      [
        { citingPaperId: 'p1', citedPaperId: 'x' },
        { citingPaperId: 'y', citedPaperId: 'p1' },
        { citingPaperId: 'x', citedPaperId: 'y' }, // 与 p1 无关
      ],
    )
    expect(rows[0].citations).toBe(2)
  })

  it('阅读时长换算成分钟（与 /api/research-stats 同口径），并向下兜住脏值', () => {
    const rows = buildManuscriptEvidence(
      ['a', 'b', 'c'],
      [P('a', { readingTime: 600 }), P('b', { readingTime: 59 }), P('c', { readingTime: -10 })],
      [],
      [],
    )
    expect(rows[0].readingMinutes).toBe(10)
    expect(rows[1].readingMinutes).toBe(1) // 四舍五入，不是截断
    expect(rows[2].readingMinutes).toBe(0) // 负值不许变成负数分钟
  })

  it('脏阅读状态一律当未读（宁可漏报已读，也不能把没读的说成读过）', () => {
    const rows = buildManuscriptEvidence(
      ['a', 'b', 'c'],
      [P('a', { status: null }), P('b', { status: '' }), P('c', { status: 'read' })],
      [],
      [],
    )
    expect(rows.map((r) => r.status)).toEqual(['unread', 'unread', 'read'])
  })

  it('查不到的引文不会有证据项（`missing` 单独告警，不能靠这里凑）', () => {
    const rows = buildManuscriptEvidence(['p1', 'ghost'], [P('p1')], [], [])
    expect(rows.map((r) => r.paperId)).toEqual(['p1'])
  })

  it('空输入不炸', () => {
    expect(buildManuscriptEvidence([], [], [], [])).toEqual([])
  })
})

const read = (p: string) => readFileSync(path.resolve(p), 'utf8')

describe('「引文证据」通道：两端缺一个就是死的', () => {
  it('store 提供投递与取出，且**不持久化**（重启后自动跳页比不动更困惑）', () => {
    const src = read('src/lib/store.ts')
    expect(src).toMatch(/openPaper:/)
    expect(src).toMatch(/takePaperInbox:/)
    const partialize = src.match(/partialize:\s*\(state\)\s*=>\s*\(\{([\s\S]*?)\}\)/)
    expect(partialize, '找不到 partialize，守卫失效').toBeTruthy()
    expect(partialize![1]).not.toMatch(/paperInbox/)
    expect(partialize![1]).not.toMatch(/draftInbox/)
  })

  it('写作页发出投递（点引文的「证据」）', () => {
    const src = read('src/components/writing-workbench.tsx')
    expect(src).toMatch(/openPaper\(/)
    expect(src).toMatch(/unreadRefs/)
  })

  it('论文库页接住投递并选中那一篇', () => {
    const src = read('src/components/sections/papers-section.tsx')
    expect(src).toMatch(/takePaperInbox/)
    expect(src).toMatch(/setSelectedPaper\(target\)/)
  })

  /**
   * 这条守卫来自一次**只有真实浏览器才能发现**的 bug（2026-09-28）：
   * 论文详情挂在 `TabsContent value="detail"` 下，只设 `selectedPaper` 时
   * 用户看到的只是列表里那行被高亮、详情根本没展开（看起来像按钮没反应）。
   * 单测绿、导航类 e2e 也绿 —— 因为它们都不验证「详情是否可见」。
   */
  it('投递必须同时切到「详情」标签页（只设 selectedPaper 看不到详情）', () => {
    const src = read('src/components/sections/papers-section.tsx')
    expect(src).toMatch(/setTab\('detail'\)/)
    // 标签页必须是受控的，否则切不过去
    expect(src).toMatch(/<Tabs value=\{tab\} onValueChange=\{setTab\}>/)
  })

  it('证据数据来自服务端（引用解析与「阅读证据」必须同源，前端不许自己拼）', () => {
    const route = read('src/app/api/writing/manuscripts/[id]/references/route.ts')
    expect(route).toMatch(/evidence: resolved\.evidence/)
  })

  /**
   * 这条守卫防的是一类很难在测试里发现的回归：
   * `resolve.ts` 里 import 了 Prisma 客户端（`@/lib/db`），客户端组件若**值导入**它，
   * 服务端代码会被打进浏览器包（体积暴涨 / 运行时炸）。
   * 类型导入在编译期被擦除，所以必须钉住它一直是 `import type`。
   */
  it('客户端只以 `import type` 引用 resolve（否则 Prisma 被打进客户端包）', () => {
    const src = read('src/components/writing-workbench.tsx')
    expect(src).toMatch(/import type \{ ManuscriptEvidence \} from '@\/lib\/writing\/resolve'/)
    expect(src).not.toMatch(/import \{ ManuscriptEvidence \}/)
  })
})
