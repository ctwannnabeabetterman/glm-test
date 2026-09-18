import { describe, expect, it } from 'vitest'
import {
  formatRetrievedForPrompt,
  retrieveRelatedPapers,
  type RetrievedPaper,
} from '@/lib/library/retrieval'

/**
 * `/api/ai-related-papers` 的 `type='papers'` 原本是「让模型凭记忆报论文名」——
 * 那是科研场景里最贵的幻觉。改成「先真检索、再让模型从结果里挑」之后，
 * 这里钉住三件事：
 *  1. 检索结果必须带真实 DOI（用户能自行核实的唯一锚点）
 *  2. 检索失败必须**安静降级**（返回空数组，不抛），绝不能把整个推荐功能带崩
 *  3. 拼给模型的清单必须带 `[n]` 编号，才能约束模型「只许引用清单里的条目」
 */
describe('retrieval —— 真实文献检索的降级与格式化契约', () => {
  describe('formatRetrievedForPrompt', () => {
    const sample: RetrievedPaper[] = [
      {
        title: 'Deep reinforcement learning for network routing',
        authors: 'Song, Li 等 4 人',
        year: 2026,
        venue: 'Neurocomputing',
        doi: '10.1016/j.neucom.2025.132263',
        citations: 4,
        url: 'https://doi.org/10.1016/j.neucom.2025.132263',
        abstract: '',
      },
      {
        title: 'Explainable RL for routing',
        authors: 'Xiu',
        year: 0, // 上游没给年份
        venue: '', // 也没给期刊
        doi: '10.31979/etd.h7jx-ca2n',
        citations: 0,
        url: 'https://doi.org/10.31979/etd.h7jx-ca2n',
        abstract: '',
      },
    ]

    it('每条都带 [n] 编号 —— 这是约束模型「只许引用清单内条目」的抓手', () => {
      const text = formatRetrievedForPrompt(sample)
      expect(text).toContain('[1] Deep reinforcement learning for network routing')
      expect(text).toContain('[2] Explainable RL for routing')
    })

    it('带出 DOI，且绝不省略', () => {
      const text = formatRetrievedForPrompt(sample)
      expect(text).toContain('10.1016/j.neucom.2025.132263')
      expect(text).toContain('10.31979/etd.h7jx-ca2n')
    })

    it('缺年份/期刊时不留空行噪音（年份为 0、期刊为空串都要被过滤）', () => {
      const text = formatRetrievedForPrompt([sample[1]])
      expect(text).not.toContain('年份: 0')
      expect(text).not.toContain('期刊/会议: \n')
    })

    it('空数组 → 空串（调用方据此走降级分支）', () => {
      expect(formatRetrievedForPrompt([])).toBe('')
    })

    it('长摘要被截断，避免把提示词撑爆', () => {
      const long: RetrievedPaper = { ...sample[0], abstract: 'x'.repeat(2000) }
      const text = formatRetrievedForPrompt([long])
      // 300 是代码里的截断长度；留一点余量给前后缀
      expect(text.length).toBeLessThan(600)
    })
  })

  describe('retrieveRelatedPapers —— 失败必须安静降级', () => {
    it('空查询词直接返回空数组，不发请求', async () => {
      expect(await retrieveRelatedPapers('')).toEqual([])
      expect(await retrieveRelatedPapers('   ')).toEqual([])
    })

    it('网络不可达时返回空数组而不是抛异常（否则整个推荐面板会 500）', async () => {
      // 指向一个必定连不上的地址，并给极短超时逼出失败路径
      const original = globalThis.fetch
      globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
      try {
        await expect(retrieveRelatedPapers('some topic', { timeoutMs: 50 })).resolves.toEqual([])
      } finally {
        globalThis.fetch = original
      }
    })

    it('上游返回非 2xx 时返回空数组', async () => {
      const original = globalThis.fetch
      globalThis.fetch = (() =>
        Promise.resolve(new Response('rate limited', { status: 429 }))) as typeof fetch
      try {
        await expect(retrieveRelatedPapers('some topic')).resolves.toEqual([])
      } finally {
        globalThis.fetch = original
      }
    })

    it('上游返回结构损坏的 JSON 时返回空数组', async () => {
      const original = globalThis.fetch
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: { items: 'not-an-array' } }), { status: 200 })
        )) as typeof fetch
      try {
        await expect(retrieveRelatedPapers('some topic')).resolves.toEqual([])
      } finally {
        globalThis.fetch = original
      }
    })

    it('正常响应：只保留有 DOI 且有标题的条目，并解析出作者/年份/期刊', async () => {
      const payload = {
        message: {
          items: [
            {
              title: ['Routing with DRL'],
              author: [
                { given: 'San', family: 'Zhang' },
                { given: 'Si', family: 'Li' },
              ],
              issued: { 'date-parts': [[2025, 3]] },
              'container-title': ['IEEE TCOM'],
              DOI: '10.1109/tcom.2025.0001',
              'is-referenced-by-count': 12,
              URL: 'https://doi.org/10.1109/tcom.2025.0001',
              abstract: '<jats:p>We study <jats:italic>routing</jats:italic>.</jats:p>',
            },
            // 没有 DOI → 必须被丢掉（无法核实）
            { title: ['No DOI here'], author: [], issued: { 'date-parts': [[2024]] } },
            // 没有标题 → 也必须被丢掉
            { DOI: '10.1/no-title' },
          ],
        },
      }
      const original = globalThis.fetch
      globalThis.fetch = (() =>
        Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))) as typeof fetch
      try {
        const out = await retrieveRelatedPapers('routing')
        expect(out).toHaveLength(1)
        expect(out[0]).toMatchObject({
          title: 'Routing with DRL',
          year: 2025,
          venue: 'IEEE TCOM',
          doi: '10.1109/tcom.2025.0001',
          citations: 12,
        })
        // JATS 标签必须被剥掉，否则会把 XML 灌进提示词
        expect(out[0].abstract).toBe('We study routing.')
        expect(out[0].abstract).not.toContain('<jats')
        // 作者按「姓 名」拼接
        expect(out[0].authors).toContain('Zhang San')
      } finally {
        globalThis.fetch = original
      }
    })

    it('超过 3 位作者时折叠成「前 3 位 等 N 人」，避免作者串占满提示词', async () => {
      const payload = {
        message: {
          items: [
            {
              title: ['Many authors'],
              author: [
                { family: 'A' }, { family: 'B' }, { family: 'C' }, { family: 'D' }, { family: 'E' },
              ],
              issued: { 'date-parts': [[2024]] },
              DOI: '10.1/many',
            },
          ],
        },
      }
      const original = globalThis.fetch
      globalThis.fetch = (() =>
        Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))) as typeof fetch
      try {
        const out = await retrieveRelatedPapers('x')
        expect(out[0].authors).toBe('A, B, C 等 5 人')
      } finally {
        globalThis.fetch = original
      }
    })

    it('年份离谱（0 或 3000）时归一成 0，不把脏数据喂给模型', async () => {
      const payload = {
        message: {
          items: [
            { title: ['Bad year'], issued: { 'date-parts': [[3000]] }, DOI: '10.1/bad' },
            { title: ['No year'], DOI: '10.1/none' },
          ],
        },
      }
      const original = globalThis.fetch
      globalThis.fetch = (() =>
        Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))) as typeof fetch
      try {
        const out = await retrieveRelatedPapers('x')
        expect(out.map((p) => p.year)).toEqual([0, 0])
      } finally {
        globalThis.fetch = original
      }
    })

    it('limit 被夹在 1..20，防止调用方传个巨大值把响应撑爆', async () => {
      let seenUrl = ''
      const original = globalThis.fetch
      globalThis.fetch = ((url: string) => {
        seenUrl = String(url)
        return Promise.resolve(new Response(JSON.stringify({ message: { items: [] } }), { status: 200 }))
      }) as typeof fetch
      try {
        await retrieveRelatedPapers('x', { limit: 9999 })
        expect(seenUrl).toContain('rows=20')
        await retrieveRelatedPapers('x', { limit: -5 })
        expect(seenUrl).toContain('rows=1')
      } finally {
        globalThis.fetch = original
      }
    })
  })
})
