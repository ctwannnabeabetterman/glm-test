import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「AI 摘要的原料」与「论文推荐的出处」—— 两项治本修复的回归线。
 *
 * 背景（2026-09-18）：
 *  - `Paper` 模型原本**没有摘要字段**，于是 `/api/ai-summary` 的「快速摘要」
 *    在用户没写笔记时手里没有任何原料，模型只能编 —— 这是最隐蔽的一类幻觉。
 *  - `/api/ai-related-papers` 的「推荐 5 篇论文」原本纯靠模型记忆，
 *    加了防编造约束只是让它「更谨慎地编」，本质没变。
 *
 * 两项修复的共同点是：**它们都是「有没有真东西可用」的问题，不是提示词措辞问题**。
 * 所以这里同时做静态守卫（字段/调用必须在位）与行为守卫（降级路径必须存在）。
 */

const read = (p: string) => readFileSync(path.resolve(p), 'utf8')

describe('任务一：Paper 必须有摘要原料', () => {
  it('Prisma schema 的 Paper 带 abstract 列', () => {
    const schema = read('prisma/schema.prisma')
    const paperBlock = schema.slice(schema.indexOf('model Paper'), schema.indexOf('model Topic'))
    expect(paperBlock).toMatch(/\babstract\s+String\s+@default\(""\)/)
  })

  it('桌面端迁移脚本会为老库补 abstract 列（默认值与 schema 一致）', () => {
    const migrate = read('desktop/migrate-database.js')
    expect(migrate).toMatch(/abstract:\s*"abstract TEXT DEFAULT ''"/)
  })

  it('Zotero 的 abstractNote 落到 abstract，而不是塞进 notes', () => {
    const src = read('src/lib/library/zotero.ts')
    expect(src).toMatch(/abstract:\s*\(d\.abstractNote/)
    // 旧的错法：notes: d.abstractNote —— 会把摘要写进用户的笔记字段
    expect(src).not.toMatch(/notes:\s*d\.abstractNote/)
  })

  it('ai-summary 把摘要喂给模型，并按「有无摘要」切换约束口径', () => {
    const src = read('src/app/api/ai-summary/route.ts')
    // 1. 必须真的读 paper.abstract
    expect(src).toMatch(/paper\.abstract/)
    // 2. 必须有 hasAbstract 分派
    expect(src).toMatch(/hasAbstract\s*=\s*abstractText\.length\s*>\s*0/)
    expect(src).toMatch(/const guard = hasAbstract \? NO_FABRICATION_GUARD : METADATA_ONLY_GUARD/)
    // 3. 有摘要时必须把摘要正文拼进提示词
    expect(src).toMatch(/摘要原文/)
  })

  it('ai-summary 回传 basedOn，让前端能提示「这次是靠推测」', () => {
    const src = read('src/app/api/ai-summary/route.ts')
    expect(src).toMatch(/basedOn:\s*hasAbstract\s*\?\s*'abstract'\s*:\s*'metadata'/)
    const panel = read('src/components/ai-summary.tsx')
    expect(panel).toMatch(/basedOn/)
    // 面板必须把只有元数据这件事如实告诉用户，而不是让他以为读的是原文
    expect(panel).toMatch(/推测/)
  })
})

describe('任务二：论文推荐必须来自真实检索', () => {
  it('存在检索模块，且使用 Crossref（免 Key、DOI 可核实）', () => {
    const src = read('src/lib/library/retrieval.ts')
    expect(src).toMatch(/api\.crossref\.org/)
    expect(src).toMatch(/export async function retrieveRelatedPapers/)
    // 必须要求 DOI —— 这是用户能自行核实的关键锚点
    expect(src).toMatch(/if \(!doi\) continue/)
  })

  it('检索失败时返回空数组而不是抛异常（不能把整个推荐面板带崩）', () => {
    const src = read('src/lib/library/retrieval.ts')
    // catch 块里必须 return []，不能 throw
    const catchBlock = src.slice(src.indexOf('} catch {'), src.indexOf('} finally {'))
    expect(catchBlock).toMatch(/return \[\]/)
    expect(catchBlock).not.toMatch(/throw/)
  })

  it('ai-related-papers 在 type=papers 时先检索、再让模型从结果里挑', () => {
    const src = read('src/app/api/ai-related-papers/route.ts')
    expect(src).toMatch(/retrieveRelatedPapers/)
    expect(src).toMatch(/formatRetrievedForPrompt/)
    // 提示词必须明确「只能从清单里挑、字段逐字照抄」—— 这是把幻觉堵死的那句话
    expect(src).toMatch(/只能从这份清单里挑选/)
    expect(src).toMatch(/不得.*修改清单里给出/)
  })

  it('检索失败时降级为「纯模型知识」并如实标注', () => {
    const src = read('src/app/api/ai-related-papers/route.ts')
    expect(src).toMatch(/source:\s*retrieved\.length > 0 \? 'crossref' : 'model-knowledge'/)
    // 降级路径必须提醒用户自行核实
    expect(src).toMatch(/自行核实/)
  })

  it('检索结果（含 DOI）随响应回传，用户可逐条点开核实', () => {
    const src = read('src/app/api/ai-related-papers/route.ts')
    expect(src).toMatch(/retrieved,/)
    const panel = read('src/components/ai-related-papers.tsx')
    // 面板要渲染可点击的 DOI 链接
    expect(panel).toMatch(/doi\.org/)
    expect(panel).toMatch(/target="_blank"/)
    // 并且要显示来源说明
    expect(panel).toMatch(/crossref/)
  })
})
