import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AiMarkdown } from '@/components/ai-markdown'

/**
 * AI 输出渲染的契约测试。
 *
 * 用户反馈的原话是「AI 的回答是直接把所有复制回来」—— 因为结果用
 * `whitespace-pre-wrap` 当纯文本渲染，模型返回的 `**加粗**`、`| 表格 |`
 * 全都原样显示。这里用服务端渲染把「渲染后到底是什么 HTML」钉住，
 * 免得哪天有人为了省事又换回纯文本。
 *
 * 为什么可以在这里渲染 tsx：vitest 的 esbuild 会直接处理 .tsx 的 JSX，
 * `react-dom/server` 在 node 环境下可用（不需要 jsdom）。
 */

const html = (content: string, size?: 'compact' | 'default' | 'loose') =>
  renderToStaticMarkup(createElement(AiMarkdown, { content, size }))

describe('AiMarkdown：真的渲染 Markdown，而不是原样显示', () => {
  it('`**加粗**` 变成 <strong>，星号不留在文本里', () => {
    const out = html('**研究问题**：语义通信')
    expect(out).toContain('<strong')
    expect(out).not.toContain('**')
  })

  it('标题被降级：`#` 不会渲染成 h1（否则会把面板布局撑爆）', () => {
    expect(html('# 总标题')).not.toContain('<h1')
    expect(html('# 总标题')).toContain('<h2')
    expect(html('## 二级标题')).toContain('<h3')
  })

  it('无序列表与有序列表都渲染成真正的列表', () => {
    const ul = html('- 第一点\n- 第二点')
    expect(ul).toContain('<ul')
    expect((ul.match(/<li/g) ?? []).length).toBe(2)

    const ol = html('1. 第一步\n2. 第二步')
    expect(ol).toContain('<ol')
  })

  it('GFM 表格渲染成 <table>（这是 5 个面板的主要输出形式）', () => {
    const md = ['| 方法 | 类型 |', '| --- | --- |', '| A | 传统 |', '| B | SOTA |'].join('\n')
    const out = html(md)
    expect(out).toContain('<table')
    expect(out).toContain('<th')
    expect((out.match(/<td/g) ?? []).length).toBe(4)
    // 没有 GFM 管线的话这里会退化成一段带竖线的段落
    expect(out).not.toContain('| --- |')
  })

  it('行内代码与代码块分别渲染', () => {
    expect(html('用 `npm test` 跑')).toContain('<code')
    expect(html('```\nconst a = 1\n```')).toContain('<pre')
  })

  it('空内容不炸', () => {
    expect(() => html('')).not.toThrow()
    expect(html('')).toContain('ai-markdown')
  })
})

describe('AiMarkdown：不可信内容的处理', () => {
  it('不渲染 raw HTML：标签被转义成惰性文本，不会生成元素', () => {
    const out = html('<img src=x onerror="alert(1)">')
    // 关键断言是「没有生成 <img> 元素」；标签本身应以实体形式原样显示给用户
    // （实测输出：&lt;img src=x onerror=&quot;alert(1)&quot;&gt;）
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).toContain('&quot;')
    // 没有被当成属性注入到 wrapper 上
    expect(out).not.toMatch(/<div[^>]*onerror/)
  })

  it('iframe / script 同理不会变成真元素', () => {
    expect(html('<iframe src="//evil"></iframe>')).not.toContain('<iframe')
    expect(html('<script>alert(1)</script>')).not.toContain('<script')
  })

  it('javascript: 链接不渲染成 <a>', () => {
    const out = html('[点我](javascript:alert(1))')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('href')
  })

  it('http/https 链接渲染成新窗口打开的外链', () => {
    const out = html('[论文](https://example.com/a)')
    expect(out).toContain('href="https://example.com/a"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noreferrer"')
  })
})

describe('AiMarkdown：排版成档', () => {
  it('size 决定基础字号，避免每个面板各调一套', () => {
    expect(html('正文', 'compact')).toContain('text-[11px]')
    expect(html('正文', 'default')).toContain('text-xs')
    expect(html('正文', 'loose')).toContain('text-sm')
  })

  it('表格外层可横向滚动，避免宽表撑破面板', () => {
    const out = html(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'))
    expect(out).toContain('overflow-x-auto')
  })
})
