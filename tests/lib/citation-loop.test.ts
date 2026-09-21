import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 「跨面板插入引用」这条通道的**接线**契约。
 *
 * 它横跨 5 个文件：按钮组件 → store 的一次性投递 → 写作工作台的消费端。
 * 任何一处缺了都不会报错，只会表现为「点了按钮，什么都没发生」——
 * 那种失败最难查（没有报错、没有日志、只有一个不动的界面）。
 * 所以这里按文件逐处钉住，改坏了至少测试会红。
 */

const read = (p: string) => readFileSync(path.resolve(p), 'utf8')

describe('一次性投递：两种落点', () => {
  const store = read('src/lib/store.ts')

  it('DraftInbox 支持 section / append 两种模式与目标章节名', () => {
    expect(store).toMatch(/mode: 'section' \| 'append'/)
    expect(store).toMatch(/targetTitle\?: string/)
    expect(store).toMatch(/mode: mode \?\? 'section'/)
  })

  it('待插入内容依然不持久化（重启后不该突然冒出一段待插正文）', () => {
    const partialize = store.slice(store.indexOf('partialize'))
    expect(partialize.slice(0, 400)).not.toMatch(/draftInbox/)
  })
})

describe('写作工作台：两种模式都要接住', () => {
  const wb = read('src/components/writing-workbench.tsx')

  it('append 模式走 pickAppendTarget / appendToSection', () => {
    expect(wb).toMatch(/pickAppendTarget/)
    expect(wb).toMatch(/appendToSection/)
    expect(wb).toMatch(/job\.mode === 'append'/)
  })

  it('插入后要告诉用户插到了哪一章（否则用户得自己去翻）', () => {
    expect(wb).toMatch(/章节末尾 —— 引用会自动编号/)
  })

  it('没有落点时退化成新建章节（不能静默什么都不做）', () => {
    expect(wb).toMatch(/newSection\(job\.title/)
  })
})

describe('插入引用按钮：一处调用即完成投递 + 跳转', () => {
  const btn = read('src/components/insert-citation-button.tsx')

  it('生成 [@id] / [@a, @b] 标记并走 append 模式', () => {
    expect(btn).toMatch(/\[@\$\{ids\.join\(', '\)\}\]/)
    expect(btn).toMatch(/mode: 'append'/)
    expect(btn).toMatch(/targetTitle/)
  })

  it('投递后切到写作页 —— 让用户当场看到它落在哪', () => {
    expect(btn).toMatch(/setSection\('writing'\)/)
  })
})

describe('三处调用方都接了「插入引用」', () => {
  it.each([
    ['src/components/citation-tracker.tsx', '引用追踪：排行 Top 与逐条引用关系'],
    ['src/components/paper-relations.tsx', '关系网络：一条关系＝两篇一起引'],
    ['src/components/sections/papers-section.tsx', '论文详情：BibTeX 卡片旁'],
  ])('%s 使用 InsertCitationButton（%s）', (file) => {
    expect(read(file)).toMatch(/InsertCitationButton/)
  })

  it('引用排行的批量插入默认取前 5 篇（一次把最常被引的几篇送进稿子）', () => {
    expect(read('src/components/citation-tracker.tsx')).toMatch(/topCited\.slice\(0, 5\)/)
  })
})

describe('AI 打分面板：接线与「来源可见」', () => {
  const panel = read('src/components/paper-score-panel.tsx')
  const section = read('src/components/sections/papers-section.tsx')

  it('面板把课题域 + 范围 + 上限发给 /api/ai-paper-score', () => {
    expect(panel).toMatch(/\/api\/ai-paper-score/)
    expect(panel).toMatch(/topicId:/)
    expect(panel).toMatch(/scope,/)
    expect(panel).toMatch(/limit,/)
  })

  it('两步式：先出建议（可勾选），再写回 —— 不做「一键全改」', () => {
    expect(panel).toMatch(/\/api\/papers\/apply-scores/)
    expect(panel).toMatch(/deselected/)
    expect(panel).toMatch(/全不选/)
  })

  it('清单外的 id 会当场告警（模型编造不能静默）', () => {
    expect(panel).toMatch(/unknownIds/)
    expect(panel).toMatch(/不在本批清单里/)
  })

  it('论文库页挂上了面板，并在写回后刷新分数与来源标记', () => {
    expect(section).toMatch(/<PaperScorePanel/)
    expect(section).toMatch(/refetchProvenance\(\)/)
    expect(section).toMatch(/readingPriorityScore\(p\)/)
  })

  it('排序已改为纯函数层，UI 里不再有第二份公式', () => {
    expect(section).toMatch(/rankByPriority\(filtered\)/)
    // 旧的重复实现不能残留（改一处忘一处 = 显示分数与排序依据不一致）
    expect(section).not.toMatch(/novelty \* 0\.3/)
    expect(section).not.toMatch(/const PRIORITY_RANK/)
  })

  it('AI 徽标只在真的有来源标记时显示', () => {
    expect(section).toMatch(/aiScoredAt/)
    expect(section).toMatch(/AI 评/)
  })
})
