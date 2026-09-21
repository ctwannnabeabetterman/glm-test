import { describe, expect, it } from 'vitest'
import {
  PRIORITY_LABEL,
  PRIORITY_RANK,
  SCORE_PROVENANCE_KEY,
  clearScored,
  describeScoreParts,
  diffSuggestion,
  extractJsonBlock,
  isPriority,
  markScored,
  normalizePriority,
  normalizeScore,
  parseProvenance,
  parseScoreSuggestions,
  rankByPriority,
  readingPriorityScore,
  scoreParts,
  type ScorablePaper,
} from '@/lib/library/reading-priority'

/**
 * 旧实现（`papers-section.tsx` 里被复制了三份的那个比较器/渲染式）**原样**照抄到这里，
 * 用来做「抽层前后行为完全一致」的对照。改 `readingPriorityScore` 的语义会在这里立刻变红 ——
 * 这是刻意的：那张榜是用户已经熟悉的，静默重排比留着一个不好看的公式更糟。
 */
function legacyScore(p: { relevance: number; novelty: number; codeUrl?: string | null; year: number; priority: string }): number {
  return (
    p.relevance * 0.4 +
    p.novelty * 0.3 +
    (p.codeUrl ? 15 : 0) +
    Math.min(p.year - 2019, 5) * 0.5 +
    (PRIORITY_RANK as Record<string, number>)[p.priority] * 2
  )
}

function paper(over: Partial<ScorablePaper> = {}): ScorablePaper {
  return {
    id: 'p1',
    title: 'A Paper',
    year: 2024,
    codeUrl: '',
    relevance: 5,
    novelty: 5,
    priority: 'medium',
    ...over,
  }
}

describe('打分：与旧实现逐字节等价', () => {
  const CASES = [
    paper(),
    paper({ relevance: 10, novelty: 10, priority: 'high', codeUrl: 'github.com/x', year: 2026 }),
    paper({ relevance: 1, novelty: 1, priority: 'low', year: 2011 }),
    paper({ relevance: 8, novelty: 3, priority: 'high', year: 2019 }),
    paper({ relevance: 7, novelty: 9, priority: 'medium', codeUrl: 'https://github.com/y/z', year: 2021 }),
  ]

  it.each(CASES)('$title r=$relevance n=$novelty pri=$priority y=$year', (p) => {
    expect(readingPriorityScore(p)).toBeCloseTo(legacyScore(p), 10)
  })

  it('脏优先级：旧实现会算出 NaN，这里按 medium 兜底（是修复，不是行为漂移）', () => {
    const dirty = paper({ priority: 'unknown-value' })
    expect(Number.isNaN(legacyScore(dirty))).toBe(true)
    expect(readingPriorityScore(dirty)).toBe(readingPriorityScore(paper({ priority: 'medium' })))
  })

  it('分数构成相加等于总分', () => {
    for (const p of CASES) {
      const s = scoreParts(p)
      expect(s.relevance + s.novelty + s.code + s.year + s.priority).toBeCloseTo(readingPriorityScore(p), 10)
    }
  })

  it('2019 年之前的年份项为负 —— 既有行为，界面上如实说明「早于 2019，为负」', () => {
    expect(scoreParts(paper({ year: 2011 })).year).toBeLessThan(0)
    expect(describeScoreParts(paper({ year: 2011, title: 'T' }))).toContain('早于 2019，为负')
    // 2024 与 2029 都被封顶在 +5×0.5 = 2.5
    expect(scoreParts(paper({ year: 2024 })).year).toBe(2.5)
    expect(scoreParts(paper({ year: 2031 })).year).toBe(2.5)
  })

  it('未知优先级按 medium 计（不让脏值把这一项算成 NaN）', () => {
    expect(readingPriorityScore(paper({ priority: 'urgent' }))).toBe(readingPriorityScore(paper({ priority: 'medium' })))
    expect(Number.isNaN(readingPriorityScore(paper({ year: Number.NaN, relevance: Number.NaN })))).toBe(false)
  })

  it('describeScoreParts 把五个分量都写出来（避免公式再被抄成界面字符串）', () => {
    const t = describeScoreParts(paper({ codeUrl: 'x', priority: 'high' }))
    for (const label of ['相关度', '新颖度', '开源代码', '年份', '优先级', '合计']) {
      expect(t).toContain(label)
    }
  })
})

describe('排序：稳定且可复现', () => {
  it('按分数降序', () => {
    const list = [
      paper({ id: 'low', relevance: 1, novelty: 1, priority: 'low' }),
      paper({ id: 'high', relevance: 10, novelty: 10, priority: 'high' }),
      paper({ id: 'mid', relevance: 5, novelty: 5, priority: 'medium' }),
    ]
    expect(rankByPriority(list).map((p) => p.id)).toEqual(['high', 'mid', 'low'])
  })

  it('同分时按年份降序、再按标题升序（不依赖引擎的稳定排序行为）', () => {
    const a = paper({ id: 'a', title: 'Beta', year: 2020, relevance: 5, novelty: 5 })
    const b = paper({ id: 'b', title: 'Alpha', year: 2020, relevance: 5, novelty: 5 })
    const c = paper({ id: 'c', title: 'Gamma', year: 2023, relevance: 5, novelty: 5 })
    // 打乱输入顺序，结果必须一致
    expect(rankByPriority([a, b, c]).map((p) => p.id)).toEqual(['c', 'b', 'a'])
    expect(rankByPriority([c, b, a]).map((p) => p.id)).toEqual(['c', 'b', 'a'])
  })

  it('不修改入参（上游是 React state，就地排序会引发难查的重渲染问题）', () => {
    const list = [paper({ id: 'x', relevance: 1 }), paper({ id: 'y', relevance: 10 })]
    const snapshot = list.map((p) => p.id)
    rankByPriority(list)
    expect(list.map((p) => p.id)).toEqual(snapshot)
  })
})

describe('数值与枚举收敛', () => {
  it('normalizeScore 夹紧到 1-10 的整数，非数字回落', () => {
    expect(normalizeScore(9.6)).toBe(10)
    expect(normalizeScore(0)).toBe(1)
    expect(normalizeScore(-3)).toBe(1)
    expect(normalizeScore(99)).toBe(10)
    expect(normalizeScore('7')).toBe(7)
    expect(normalizeScore('abc')).toBe(5)
    expect(normalizeScore(null)).toBe(5)
    expect(normalizeScore(undefined, 8)).toBe(8)
  })

  it('normalizePriority 收下常见近义写法', () => {
    expect(normalizePriority('high')).toBe('high')
    expect(normalizePriority(' HIGH ')).toBe('high')
    expect(normalizePriority('高')).toBe('high')
    expect(normalizePriority('top')).toBe('high')
    expect(normalizePriority('低')).toBe('low')
    expect(normalizePriority('urgent')).toBe('medium')
    expect(normalizePriority(null)).toBe('medium')
  })

  it('isPriority 只认三个合法值', () => {
    expect(isPriority('high')).toBe(true)
    expect(isPriority('medium')).toBe(true)
    expect(isPriority('low')).toBe(true)
    expect(isPriority('HIGH')).toBe(false)
    expect(isPriority(1)).toBe(false)
    // 用等值判断而不是数组 includes —— 后者在字面量数组上会与 TS 版本打架
    expect(Object.keys(PRIORITY_RANK)).toEqual(['high', 'medium', 'low'])
    expect(PRIORITY_LABEL).toMatchObject({ high: '高', medium: '中', low: '低' })
  })
})

describe('parseScoreSuggestions —— 模型输出不可信，这里是唯一收口处', () => {
  const KNOWN = ['p1', 'p2']

  it('解析 ```json 围栏与前后客套话', () => {
    const raw = '好的，结果如下：\n```json\n{"scores":[{"id":"p1","relevance":9,"novelty":7,"priority":"high","reason":"与课题高度相关"}]}\n```\n希望有帮助。'
    const r = parseScoreSuggestions(raw, KNOWN)
    expect(r.suggestions).toEqual([
      { id: 'p1', relevance: 9, novelty: 7, priority: 'high', reason: '与课题高度相关' },
    ])
    expect(r.unknownIds).toEqual([])
    expect(r.malformed).toBe(0)
  })

  it('接受裸数组与 items/results 等替代键', () => {
    expect(parseScoreSuggestions('[{"id":"p1"}]', KNOWN).suggestions).toHaveLength(1)
    expect(parseScoreSuggestions('{"items":[{"id":"p2"}]}', KNOWN).suggestions).toHaveLength(1)
    expect(parseScoreSuggestions('{"results":[{"id":"p2"}]}', KNOWN).suggestions).toHaveLength(1)
  })

  it('清单之外的 id 不采纳，但**原样报出来**（编造的引用/串号必须让人看见）', () => {
    const raw = '{"scores":[{"id":"p1","relevance":8},{"id":"ghost-999","relevance":10},{"id":"p2","relevance":3}]}'
    const r = parseScoreSuggestions(raw, KNOWN)
    expect(r.suggestions.map((s) => s.id)).toEqual(['p1', 'p2'])
    expect(r.unknownIds).toEqual(['ghost-999'])
  })

  it('越界/非法值被夹紧而不是丢掉整条建议', () => {
    const r = parseScoreSuggestions('{"scores":[{"id":"p1","relevance":99,"novelty":-4,"priority":"非常高"}]}', KNOWN)
    expect(r.suggestions[0]).toMatchObject({ relevance: 10, novelty: 1, priority: 'medium' })
  })

  it('同一个 id 出现多次时只取第一条（后一条常是模型纠错前的旧值）', () => {
    const r = parseScoreSuggestions('{"scores":[{"id":"p1","relevance":9},{"id":"p1","relevance":2}]}', KNOWN)
    expect(r.suggestions).toHaveLength(1)
    expect(r.suggestions[0].relevance).toBe(9)
  })

  it('缺 id / 非对象条目记进 malformed，不让整批失败', () => {
    const r = parseScoreSuggestions('{"scores":[{"relevance":9},"nonsense",null,{"id":"p1","relevance":7}]}', KNOWN)
    expect(r.malformed).toBe(3)
    expect(r.suggestions.map((s) => s.id)).toEqual(['p1'])
  })

  it('完全解析不出 JSON 时返回空结果而不是抛错', () => {
    expect(parseScoreSuggestions('模型今天不想输出 JSON', KNOWN)).toMatchObject({
      suggestions: [],
      unknownIds: [],
      malformed: 0,
    })
    expect(parseScoreSuggestions('', KNOWN).suggestions).toEqual([])
  })

  it('reason 被压成单行并截断，避免长文本把界面撑坏', () => {
    const long = 'a'.repeat(300)
    const r = parseScoreSuggestions(`{"scores":[{"id":"p1","reason":"第一行\\n第二行  ${long}"}]}`, KNOWN)
    expect(r.suggestions[0].reason.length).toBeLessThanOrEqual(120)
    expect(r.suggestions[0].reason).not.toContain('\n')
  })

  it('extractJsonBlock 对围栏/夹带文本/坏 JSON 的处理', () => {
    expect(extractJsonBlock('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }])
    expect(extractJsonBlock('前言 {"a":1} 后记')).toEqual({ a: 1 })
    expect(extractJsonBlock('没有 JSON')).toBeNull()
    expect(extractJsonBlock('{坏掉的')).toBeNull()
    expect(extractJsonBlock('')).toBeNull()
  })
})

describe('diffSuggestion —— 只显示真的变了的项', () => {
  const before = paper({ id: 'p1', relevance: 5, novelty: 5, priority: 'medium' })

  it('全部相同时 changed=false（界面上不必给「应用」按钮）', () => {
    const d = diffSuggestion(before, { id: 'p1', relevance: 5, novelty: 5, priority: 'medium', reason: '' })
    expect(d.changed).toBe(false)
    expect(d.changes).toEqual([])
    expect(d.scoreDelta).toBe(0)
  })

  it('列出每一项的变化与总分位移', () => {
    const d = diffSuggestion(before, { id: 'p1', relevance: 9, novelty: 8, priority: 'high', reason: '' })
    expect(d.changes).toEqual(['相关度 5→9', '新颖度 5→8', '优先级 中→高'])
    // 相关度 +4×0.4=1.6、新颖度 +3×0.3=0.9、优先级 +1×2=2 ⇒ +4.5
    expect(d.scoreDelta).toBeCloseTo(4.5, 10)
  })

  it('脏的旧优先级也能显示成人话', () => {
    const d = diffSuggestion(paper({ priority: 'urgent' }), {
      id: 'p1', relevance: 5, novelty: 5, priority: 'high', reason: '',
    })
    expect(d.changes.some((c) => c.startsWith('优先级 urgent→高'))).toBe(true)
  })
})

describe('来源标记：这条分数是 AI 给的还是人给的', () => {
  it('键名固定（加数据库列才需要迁移，这里刻意不加）', () => {
    expect(SCORE_PROVENANCE_KEY).toBe('papers.ai-scored')
  })

  it('parseProvenance 容忍字符串 / 坏数据 / 早期形态', () => {
    expect(parseProvenance('')).toEqual({})
    expect(parseProvenance('{坏 JSON')).toEqual({})
    expect(parseProvenance(null)).toEqual({})
    expect(parseProvenance([1, 2])).toEqual({})
    expect(parseProvenance({ p1: { at: '2026-09-21T00:00:00.000Z' } })).toEqual({
      p1: { at: '2026-09-21T00:00:00.000Z' },
    })
    // 早期/手写形态：值直接是时间串
    expect(parseProvenance('{"p1":"2026-01-01"}')).toEqual({ p1: { at: '2026-01-01' } })
    expect(parseProvenance({ p1: { at: 'x', note: 'batch' } })).toEqual({ p1: { at: 'x', note: 'batch' } })
  })

  it('markScored 累加、clearScored 只摘指定项', () => {
    let m = markScored({}, ['p1', 'p2'], 'T1')
    expect(m).toEqual({ p1: { at: 'T1' }, p2: { at: 'T1' } })
    m = markScored(m, ['p2'], 'T2')
    expect(m.p2.at).toBe('T2')
    m = clearScored(m, ['p2'])
    expect(m).toEqual({ p1: { at: 'T1' } })
  })

  it('空 id 被忽略（不让一条坏数据写出 `""` 键）', () => {
    expect(markScored({}, ['', 'p1'], 'T')).toEqual({ p1: { at: 'T' } })
  })
})
