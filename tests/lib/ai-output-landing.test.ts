import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 源码守卫：**AI 的输出必须能落地**。
 *
 * 背景（2026-09-23 用户反馈「AI 说的话可以导入吗」）：在统一操作栏出现之前，
 * 全应用 10 项 AI 能力里只有「AI 综述」一条能把结果送出面板，其余 6 项
 * （摘要 / 摘要生成 / 方向探索 / 实验建议 / 研究空白 / 相关论文）的结果
 * 只活在组件自己的 `useState` 里，**只有一个「复制」按钮，关掉页面就没了**。
 *
 * 这类退化是**静默**的：编译器不会说「你少写了一个导入按钮」，e2e 也不会
 * （用例点的是「生成」按钮，不看结果区）。所以这里像 `activity.test.ts`
 * 那样用源码守卫钉住：新增 AI 面板时如果漏接落地操作栏，本机就红。
 *
 * ⚠️ 这是**结构守卫**，不是行为测试 —— 它保证「接线还在」，
 * 真正的落库由 `notes-payload.test.ts` / `papers-import-records.test.ts` 与
 * 本机 e2e 覆盖。
 */

const REPO = process.cwd()
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8')

/** 所有会把「一段 AI 正文」展示给用户的面板都必须接上落地操作栏 */
const AI_OUTPUT_PANELS = [
  'src/components/ai-summary.tsx',
  'src/components/ai-abstract-generator.tsx',
  'src/components/ai-direction-explorer.tsx',
  'src/components/ai-experiment-advisor.tsx',
  'src/components/ai-gap-analysis.tsx',
  'src/components/ai-related-papers.tsx',
]

describe('AI 输出落地操作栏', () => {
  it('每个 AI 输出面板都引用了 AiOutputActions 并真的渲染它', () => {
    for (const file of AI_OUTPUT_PANELS) {
      const src = read(file)
      expect(src, `${file} 没有 import AiOutputActions`).toContain('ai-output-actions')
      expect(src, `${file} 没有渲染 <AiOutputActions`).toContain('<AiOutputActions')
    }
  })

  it('没有面板退回「只能复制」的老样子', () => {
    for (const file of AI_OUTPUT_PANELS) {
      const src = read(file)
      // 老写法的特征：自己的 copy 函数 / 裸 <Copy> 图标按钮
      expect(src, `${file} 还留着 copy 函数`).not.toMatch(/const copy = /)
      expect(src, `${file} 还留着裸 Copy 图标按钮`).not.toContain('<Copy')
    }
  })

  it('操作栏三件事齐备：复制 / 存为笔记 / 送到写作', () => {
    const src = read('src/components/ai-output-actions.tsx')
    expect(src).toContain('复制')
    expect(src).toContain('存为笔记')
    expect(src).toContain('送到写作')
    // 存为笔记走现成的笔记接口（不需要新接口）
    expect(src).toContain("api.post('/api/notes'")
  })

  it('「送到写作」必须立刻切页 —— 否则会静默丢稿', () => {
    const src = read('src/components/ai-output-actions.tsx')
    const i = src.indexOf('sendDraftToWriting(')
    expect(i, '没有调用 sendDraftToWriting').toBeGreaterThan(-1)
    // 同一个函数体内必须紧跟 setSection('writing')
    const tail = src.slice(i, i + 600)
    expect(tail, '投递后没有立刻切到写作模块：draftInbox 不持久化，用户逛一圈稿子就没了').toContain(
      "setSection('writing')",
    )
  })
})

describe('笔记 ↔ 论文双向通路', () => {
  it('笔记详情挂了「关联文献」选择器，并写回 paperIds', () => {
    const src = read('src/components/sections/notes-section.tsx')
    expect(src).toContain('PaperLinker')
    expect(src).toContain('paperIds')
    // 保存路径必须真的落到 PUT /api/notes/[id]
    expect(src).toMatch(/api\.put\(`\/api\/notes\/\$\{note\.id\}`, \{ paperIds: json \}\)/)
  })

  it('笔记列表行显示已关联的文献（PaperBadges）', () => {
    const src = read('src/components/sections/notes-section.tsx')
    expect(src).toContain('PaperBadges')
  })

  it('论文详情列出「相关笔记」', () => {
    const src = read('src/components/sections/papers-section.tsx')
    expect(src).toContain('PaperNotesPanel')
    expect(src).toContain('<PaperNotesPanel')
  })

  it('两侧共用同一个解析器，不各写一份', () => {
    const panel = read('src/components/paper-notes-panel.tsx')
    const linker = read('src/components/paper-linker.tsx')
    expect(panel).toContain("from '@/lib/notes/payload'")
    expect(linker).toContain("from '@/lib/notes/payload'")
    expect(panel).toContain('parsePaperIds')
    expect(linker).toContain('parsePaperIds')
  })
})

describe('相关论文一键入库', () => {
  it('检索结果区有导入按钮，且走 papers/import', () => {
    const src = read('src/components/ai-related-papers.tsx')
    expect(src).toContain('导入论文库')
    expect(src).toContain("'/api/papers/import'")
    // 结构化来源直接给 records，不拼 RIS 文本
    expect(src).toContain('records:')
  })
})
