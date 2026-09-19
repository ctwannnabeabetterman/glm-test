import { describe, expect, it } from 'vitest'
import {
  ALL_SUB_ITEMS,
  AI_SCORE_JSON_CONTRACT,
  SUBJECTIVE_ITEMS,
  buildScoreEvidence,
  clampScore,
  computeTotalScore,
  emptyScoreMap,
  extractJsonObject,
  interpretScorePayload,
  isSubjective,
  splitByJudge,
} from '@/lib/methodology/topic-ai'
import { TOPIC_CRITERIA } from '@/lib/methodology-data'

/**
 * AI 课题打分的纯逻辑回归线（2026-09-18 用户反馈「打分应该是 AI 打的吧」）。
 *
 * 这块的关键风险不在「模型答得准不准」，而在**我们怎么处理它的输出**：
 * 模型经常返回围栏 JSON、多写几个键、给小数、甚至某个子项漏掉。
 * 任何一个没兜住，写进库的就是脏分数，而用户会拿这个分数判断「这个课题该不该做」。
 * 所以这里逐条钉住容错行为。
 */

/**
 * 细项总数从矩阵本身推导，**不要在断言里硬编数字**。
 *
 * 这条规矩是被自己踩出来的：最初全篇按「14 项」写死，而矩阵实际是 13 项
 * （创新性 3 + 可行性 4 + 发表价值 3 + 可持续性 3），导致一堆失败用例
 * 看起来像实现有 bug。真正该钉住的性质是「与 methodology 的定义一致」，
 * 而不是某个具体数字。
 */
const SUB_ITEM_COUNT = Object.values(TOPIC_CRITERIA).reduce(
  (n, info) => n + Object.keys(info.subItems).length,
  0
)

const fullPayload = () => {
  const scores: Record<string, number> = {}
  ALL_SUB_ITEMS.forEach((name, i) => {
    scores[name] = (i % 11)
  })
  return { scores, rationale: '测试理由' }
}

describe('评分矩阵的完整性', () => {
  it(`${SUB_ITEM_COUNT} 个细项，与 methodology 的定义一致，且无重名`, () => {
    expect(ALL_SUB_ITEMS).toHaveLength(SUB_ITEM_COUNT)
    expect(new Set(ALL_SUB_ITEMS).size).toBe(SUB_ITEM_COUNT)
    // 反向确认：矩阵里每一个子项都被摊平进来了（防止 flatMap 写漏维度）
    Object.entries(TOPIC_CRITERIA).forEach(([, info]) => {
      Object.keys(info.subItems).forEach((sub) => {
        expect(ALL_SUB_ITEMS).toContain(sub)
      })
    })
  })

  it('SUBJECTIVE_ITEMS 全部来自矩阵内（写错一个字就会永远标不上「确认」）', () => {
    for (const item of SUBJECTIVE_ITEMS) {
      expect(ALL_SUB_ITEMS).toContain(item)
    }
    expect(SUBJECTIVE_ITEMS).toHaveLength(4)
  })

  it('splitByJudge 两组合起来正好是全部细项，且不重叠', () => {
    const { ai, user } = splitByJudge()
    expect(ai.length + user.length).toBe(SUB_ITEM_COUNT)
    expect(new Set([...ai, ...user]).size).toBe(SUB_ITEM_COUNT)
    expect(user.sort()).toEqual([...SUBJECTIVE_ITEMS].sort())
  })

  it('isSubjective 只认那 4 项', () => {
    expect(isSubjective('个人能力匹配度')).toBe(true)
    expect(isSubjective('问题新颖度')).toBe(false)
  })
})

describe('clampScore：把任意输入压成合法分', () => {
  it.each([
    [7, 7],
    ['7', 7],
    [' 7 ', 7],
    [7.4, 7],
    [7.6, 8],
    [-3, 0],
    [99, 10],
  ])('%o → %i', (input, expected) => {
    expect(clampScore(input)).toBe(expected)
  })

  it.each([null, undefined, '', '  ', '七分', NaN, Infinity, {}, []])(
    '非法输入 %o → null（交给调用方回退）',
    (input) => {
      expect(clampScore(input)).toBeNull()
    }
  )

  it('空字符串必须是 null 而不是 0（Number("") === 0 会把空值静默变成「0 分」）', () => {
    // 0 分在矩阵里的含义是「教科书内容 / 无任何参考实现」，是极强的负面判断，
    // 绝不能由一次空值事故产生。这条单独立一个用例，因为它最容易被无意改回去。
    expect(Number('')).toBe(0)
    expect(clampScore('')).toBeNull()
    expect(clampScore('   ')).toBeNull()
  })
})

describe('computeTotalScore：加权总分', () => {
  it('全 10 分 = 10，全 0 分 = 0（权重之和必须归一）', () => {
    expect(computeTotalScore(emptyScoreMap(10))).toBe(10)
    expect(computeTotalScore(emptyScoreMap(0))).toBe(0)
  })

  it('全 5 分 = 5（权重的两级归一都成立）', () => {
    expect(computeTotalScore(emptyScoreMap(5))).toBe(5)
  })

  it('只改一个维度时，总分变化等于该维度权重 × 变化量', () => {
    const scores = emptyScoreMap(5)
    // 创新性权重 0.30，三个子项都从 5 提到 10（子项合计权重 1）
    Object.keys(TOPIC_CRITERIA['创新性'].subItems).forEach((s) => {
      scores['创新性'][s] = 10
    })
    expect(computeTotalScore(scores)).toBeCloseTo(5 + 5 * 0.3, 2)
  })

  it('保留两位小数（避免 6.6000000000000005 这种写进库里）', () => {
    const scores = emptyScoreMap(5)
    scores['可行性']['个人能力匹配度'] = 7
    const total = computeTotalScore(scores)
    expect(String(total)).not.toMatch(/\d{10,}/)
    expect(total).toBe(Math.round(total * 100) / 100)
  })
})

describe('extractJsonObject：模型不听话时的三层退让', () => {
  it('纯 JSON 直接解析', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('围栏代码块里的 JSON', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('前后带解释文字的 JSON（只取花括号之间的部分）', () => {
    expect(extractJsonObject('好的，以下是评分：\n{"a":1}\n希望有帮助！')).toEqual({ a: 1 })
  })

  it('返回数组不算数（约定必须是对象，哪怕元素长得像评分对象）', () => {
    expect(extractJsonObject('[{"a":1}]')).toBeNull()
    expect(extractJsonObject('```json\n[{"scores":{"a":1}}]\n```')).toBeNull()
    expect(extractJsonObject('[{"a":1},{"b":2}]')).toBeNull()
  })

  it('数组在前、对象在后时，仍按对象返回（前面的数组不该把结果判成 null）', () => {
    // 反例：一刀切「看到 `[` 在 `{` 前就放弃」会让这句里的合法对象被丢掉 ——
    // 那是把「防数组」误伤成了「拒解析」。
    // 判据必须是「数组跨过了对象」而不是「数组出现在对象之前」。
    expect(extractJsonObject('参考 [1,2]，评分如下：{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('说明见 [1]，结果：{"a":1}（结束）')).toEqual({ a: 1 })
  })

  it.each(['', '完全不是 JSON', '{"broken": '])('无法解析的输入 %o → null', (input) => {
    expect(extractJsonObject(input)).toBeNull()
  })
})

describe('interpretScorePayload：把模型输出变成可信的分数表', () => {
  it('完整合法 payload → 全部细项采纳，missing 为空', () => {
    const r = interpretScorePayload(fullPayload())
    expect(r.scored).toBe(SUB_ITEM_COUNT)
    expect(r.missing).toHaveLength(0)
    expect(r.rationale).toBe('测试理由')
  })

  it('容忍「平铺一层」的写法（模型直接把子项写在根上）', () => {
    const flat: Record<string, unknown> = {}
    ALL_SUB_ITEMS.forEach((n) => { flat[n] = 8 })
    const r = interpretScorePayload(flat)
    expect(r.scored).toBe(SUB_ITEM_COUNT)
    expect(r.totalScore).toBe(8)
  })

  it('缺项用回退值补齐，并如实列进 missing（不能静默当 0 分）', () => {
    const r = interpretScorePayload({ scores: { 问题新颖度: 9 } })
    expect(r.scored).toBe(1)
    expect(r.missing).toHaveLength(SUB_ITEM_COUNT - 1)
    expect(r.scores['创新性']['问题新颖度']).toBe(9)
    // 未给的项保持回退值 5，而不是 0
    expect(r.scores['创新性']['方法创新性']).toBe(5)
  })

  it('非法分值（字符串/超范围/null）被 clamp 或回退，绝不写脏数据', () => {
    const r = interpretScorePayload({
      scores: { 问题新颖度: 99, 方法创新性: -5, 与现有工作的区分度: null },
    })
    expect(r.scores['创新性']['问题新颖度']).toBe(10)
    expect(r.scores['创新性']['方法创新性']).toBe(0)
    // null 落在 missing 而不是被当成 0
    expect(r.missing).toContain('与现有工作的区分度')
    expect(r.scores['创新性']['与现有工作的区分度']).toBe(5)
  })

  it('矩阵外的键被丢弃并记进 ignored（否则会污染导出与图表）', () => {
    const r = interpretScorePayload({ scores: { 问题新颖度: 6, 总评: '不错', advice: '加油' } })
    expect(r.ignored.sort()).toEqual(['advice', '总评'].sort())
    expect(r.scored).toBe(1)
  })

  it('rationale / totalScore 这类保留键不会被当成分数', () => {
    const r = interpretScorePayload({ scores: { totalScore: 9, rationale: 'x', 问题新颖度: 3 } })
    expect(r.scored).toBe(1)
    expect(r.ignored).toHaveLength(0)
  })

  it('payload 为 null（模型没吐 JSON）→ 全回退，missing 覆盖全部细项，一项都不冒充', () => {
    const r = interpretScorePayload(null)
    expect(r.scored).toBe(0)
    expect(r.missing).toHaveLength(SUB_ITEM_COUNT)
    expect(r.totalScore).toBe(5)
  })

  it('某一项拿到空字符串时走回退并记进 missing，而不是被当成 0 分', () => {
    const r = interpretScorePayload({ scores: { 问题新颖度: '' } })
    expect(r.scored).toBe(0)
    expect(r.missing).toContain('问题新颖度')
    expect(r.scores['创新性']['问题新颖度']).toBe(5)
  })

  it('总分是按采纳后的分数重算的，不信模型自己报的 totalScore', () => {
    const scores: Record<string, number> = {}
    ALL_SUB_ITEMS.forEach((n) => { scores[n] = 10 })
    const r = interpretScorePayload({ scores, totalScore: 3 })
    expect(r.totalScore).toBe(10)
  })

  it('返回的分数表结构永远是 4 维度 × 全部子项（前端直接 setScores 不会缺键）', () => {
    const r = interpretScorePayload(null)
    Object.entries(TOPIC_CRITERIA).forEach(([crit, info]) => {
      Object.keys(info.subItems).forEach((sub) => {
        expect(typeof r.scores[crit][sub]).toBe('number')
      })
    })
  })
})

describe('buildScoreEvidence：打分依据的组装', () => {
  it('无论文无笔记 → 计数为 0 且文本为空（路由据此拒绝而不是硬编）', () => {
    const e = buildScoreEvidence([], [])
    expect(e.paperCount).toBe(0)
    expect(e.noteCount).toBe(0)
    expect(e.text).toBe('')
  })

  it('带摘要的论文会把摘要节选带上（这是判断「做了什么」的关键原料）', () => {
    const e = buildScoreEvidence(
      [{ title: 'Deep RL Routing', venue: 'ICC', year: 2024, tags: 'rl', abstract: 'A'.repeat(500) }],
      []
    )
    expect(e.paperCount).toBe(1)
    expect(e.text).toContain('Deep RL Routing')
    expect(e.text).toContain('摘要节选')
    // 单篇摘要必须截断，否则几十篇就把提示词撑爆
    expect(e.text.length).toBeLessThan(1000)
  })

  it('笔记正文同样截断', () => {
    const e = buildScoreEvidence([], [{ title: '想法', content: 'B'.repeat(1000) }])
    expect(e.noteCount).toBe(1)
    expect(e.text.length).toBeLessThan(500)
  })
})

describe('打分提示词契约', () => {
  it('要求只输出 JSON，且禁止 Markdown 围栏（否则解析必失败）', () => {
    expect(AI_SCORE_JSON_CONTRACT).toMatch(/只输出一个 JSON 对象/)
    expect(AI_SCORE_JSON_CONTRACT).toMatch(/不要.*代码围栏/)
  })

  it('明确要求逐字照抄全部细项名', () => {
    expect(AI_SCORE_JSON_CONTRACT).toMatch(/逐字照抄/)
    // 契约里写的个数必须与矩阵实际细项数一致（曾经写死 14，实际是 13）
    expect(AI_SCORE_JSON_CONTRACT).toContain(`${SUB_ITEM_COUNT} 个细项名`)
  })

  it('要求自曝哪些是估计值（4 个主观项 AI 无从知晓）', () => {
    expect(AI_SCORE_JSON_CONTRACT).toMatch(/根据经验估计/)
  })
})
