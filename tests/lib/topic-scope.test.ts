import { describe, expect, it } from 'vitest'
import {
  extractKeywords,
  formatTopicScope,
  MATCH_REASON_LABEL,
  parseTopicIds,
  scopeByTopic,
  summarizeScope,
} from '@/lib/methodology/topic-scope'

/**
 * 「课题域」筛选的回归线。
 *
 * 对应用户原话：「AI 研究分析应该要加一个课题选择，多个同时分析内容少不说
 * 还容易在课题多了以后互相干扰」。修法的核心就是这个筛选 ——
 * 一旦它筛错（多带或者漏带），用户看到的就是「混着别的课题结论」或者
 * 「本课题明明有文献却说没材料」，两者都会让这个功能不可信。
 */

const T = { id: 't1', name: '基于DRL的RIS辅助无线资源分配', direction: '物理层', description: '' }

describe('parseTopicIds：脏数据必须兜住', () => {
  it('正常 JSON 数组', () => {
    expect(parseTopicIds('["a","b"]')).toEqual(['a', 'b'])
  })

  it.each(['', '   ', 'null', '{}', 'not json', '["a",1,null]'])('坏输入 %o 不抛异常', (raw) => {
    expect(() => parseTopicIds(raw)).not.toThrow()
  })

  it('数组里混进非字符串时只留字符串', () => {
    expect(parseTopicIds('["a",1,null,"b"]')).toEqual(['a', 'b'])
  })

  it.each([null, undefined])('nullish → 空数组', (raw) => {
    expect(parseTopicIds(raw)).toEqual([])
  })
})

describe('extractKeywords：中文课题名要能抽出实词', () => {
  it('抽得到英文缩写（大小写归一）', () => {
    const kws = extractKeywords({ id: 'x', name: 'DRL based RIS resource allocation' })
    expect(kws).toContain('drl')
    expect(kws).toContain('ris')
    expect(kws).toContain('resource')
  })

  it('抽得到中文实词片段', () => {
    const kws = extractKeywords(T)
    expect(kws).toContain('资源分配')
    expect(kws).toContain('无线')
  })

  it('过滤掉无区分度的停用词（否则等于全命中，筛选形同虚设）', () => {
    const kws = extractKeywords({ id: 'x', name: '基于深度学习的研究方法优化' })
    expect(kws).not.toContain('基于')
    expect(kws).not.toContain('研究')
    expect(kws).not.toContain('方法')
    expect(kws).not.toContain('based')
  })

  it('空课题信息不死循环、不抛异常', () => {
    expect(extractKeywords({ id: 'x', name: '' })).toEqual([])
  })
})

describe('scopeByTopic：两级筛选', () => {
  const items = [
    { id: 'p1', title: 'A survey', topicIds: '["t1"]' },
    { id: 'p2', title: 'Something about DRL routing', topicIds: '[]' },
    { id: 'p3', title: 'Totally unrelated topic', topicIds: '[]' },
    { id: 'p4', title: 'Old but relevant RIS paper', topicIds: '["t2"]' },
  ]

  it('不传课题 = 全量参与（保留旧的综合模式）', () => {
    const r = scopeByTopic(items, null)
    expect(r.matched).toHaveLength(4)
    expect(r.unmatched).toBe(0)
  })

  it('手挂的条目一定进来，且标记为 linked', () => {
    const r = scopeByTopic(items, T)
    const linked = r.matched.filter((m) => m.reason === 'linked').map((m) => m.item.id)
    expect(linked).toContain('p1')
  })

  it('关键词命中的条目也进来，标记为 keyword', () => {
    const r = scopeByTopic(items, T)
    const kw = r.matched.filter((m) => m.reason === 'keyword').map((m) => m.item.id)
    expect(kw).toContain('p2') // 标题里有 DRL
  })

  it('完全无关的条目被排除，并计入 unmatched', () => {
    const r = scopeByTopic(items, T)
    expect(r.matched.map((m) => m.item.id)).not.toContain('p3')
    expect(r.unmatched).toBeGreaterThan(0)
  })

  it('linked 排在 keyword 前面（手挂的证据强度更高，提示词里顺序即权重）', () => {
    const r = scopeByTopic(items, T)
    const reasons = r.matched.map((m) => m.reason)
    expect(reasons.indexOf('keyword')).toBeGreaterThan(reasons.indexOf('linked'))
  })

  it('「课题相关但年份较老」的论文不会因为排序被丢掉（旧实现按年份取 20 篇的坑）', () => {
    const many = [
      { id: 'new1', title: 'unrelated 2026', topicIds: '[]' },
      { id: 'new2', title: 'unrelated 2025', topicIds: '[]' },
      { id: 'old', title: 'RIS resource allocation 2018', topicIds: '[]' },
    ]
    const r = scopeByTopic(many, T)
    expect(r.matched.map((m) => m.item.id)).toContain('old')
  })

  it('空输入不炸', () => {
    const r = scopeByTopic([], T)
    expect(r.matched).toEqual([])
    expect(r.unmatched).toBe(0)
  })
})

describe('formatTopicScope：进提示词的课题描述', () => {
  it('未指定课题时给明确占位（不让模型自己猜范围）', () => {
    expect(formatTopicScope([])).toBe('（未指定课题）')
  })

  it('带上方向与描述', () => {
    const s = formatTopicScope([{ ...T, description: '面向 6G' }])
    expect(s).toContain(T.name)
    expect(s).toContain('物理层')
    expect(s).toContain('面向 6G')
  })
})

/**
 * 「材料的来源可交代」—— 2026-09-28 新增。
 *
 * 起因：`/api/ai-review` 的界面写着「只使用挂到本课题的文献；未归课题的不会算进来」，
 * 而 `scopeByTopic` 实际允许关键词兜底进来。用户以为整份综述只用了他确认过的文献。
 * 修法不是把关键词兜底去掉（那会让「没打标但有相关词」的文献直接消失），
 * 而是**让每一级来源都可分辨**，界面才能如实说。
 */
describe('summarizeScope：手挂 / 关键词 / 全库 / 未命中 必须分得开', () => {
  const items = [
    { id: 'p1', title: 'A survey', topicIds: '["t1"]' },        // 手挂
    { id: 'p2', title: 'Something about DRL routing', topicIds: '[]' }, // 关键词
    { id: 'p3', title: 'Totally unrelated topic', topicIds: '[]' },     // 未命中
  ]

  it('手挂与关键词分开计数，绝不合并成「相关」一个数', () => {
    const b = summarizeScope(scopeByTopic(items, T))
    expect(b.linked).toBe(1)
    expect(b.keyword).toBe(1)
    expect(b.unmatched).toBe(1)
    expect(b.total).toBe(3)
  })

  it('全库模式（不传课题）计入 all，而不是混进 linked', () => {
    const b = summarizeScope(scopeByTopic(items, null))
    expect(b.all).toBe(3)
    expect(b.linked).toBe(0)
    expect(b.keyword).toBe(0)
  })

  it('空输入不炸且各计数为 0', () => {
    const b = summarizeScope(scopeByTopic([], T))
    expect(b).toEqual({ linked: 0, keyword: 0, all: 0, unmatched: 0, total: 0 })
  })

  it('计数之和等于参与筛选的总数（漏一条就是界面在少报材料）', () => {
    const b = summarizeScope(scopeByTopic(items, T))
    expect(b.linked + b.keyword + b.all + b.unmatched).toBe(b.total)
  })
})

describe('不限定课题时不得声称条目「手挂」到本课题', () => {
  it('reason 是 all，不是 linked', () => {
    const r = scopeByTopic([{ id: 'x', title: 'anything', topicIds: '[]' }], null)
    expect(r.matched.map((m) => m.reason)).toEqual(['all'])
  })

  it('三种原因都有给人和模型看的说法（新增原因时不能漏掉标签）', () => {
    expect(Object.keys(MATCH_REASON_LABEL).sort()).toEqual(['all', 'keyword', 'linked'])
    for (const v of Object.values(MATCH_REASON_LABEL)) expect(v.trim().length).toBeGreaterThan(0)
  })
})
