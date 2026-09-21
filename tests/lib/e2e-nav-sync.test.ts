import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 「侧边栏 / 分区标题 / e2e 表」三者必须逐字对齐。
 *
 * 为什么需要这条测试（2026-09-21 复盘）：
 * v1.3.7 把侧边栏文案缩短了 5 处（「总览仪表盘」→「总览」、「组网仿真实验」→「组网仿真」、
 * 「文献检索工具」→「文献检索」、「方法论浏览」→「方法论」、「系统设置」→「设置」），
 * 而 `e2e/*.spec.ts` 是**按可见文案**找导航按钮的 —— 于是：
 *
 *   e2e 从 v1.3.7 起一直是红的（第一个用例 120s 超时 + serial 模式跳过其余 13 个）；
 *   而 `release.yml` 不跑 e2e，Release 一路绿 ⇒ **CI 这个信号整整四版是失效的**，
 *   没人发现，因为「本地跑不了 e2e」（没装 Playwright 浏览器）恰好也是事实。
 *
 * 这把刀子今后由本机单测兜住：**改文案会在 `npm test` 就红**，而不是等 CI 悄悄红。
 * 这也顺带回答了一个更一般的问题 ——「本地跑不了的那套验证，怎么保证它没在说谎」：
 * 至少把它的**输入**（这里就是映射表）拿回本地来校验。
 */

const repo = (p: string) => path.resolve(p)
const read = (p: string) => readFileSync(repo(p), 'utf8')

/** 侧边栏定义：`{ id: 'overview', label: '总览', ... }` */
function navItems(): Array<{ id: string; label: string }> {
  const src = read('src/components/app-shell.tsx')
  const block = src.slice(src.indexOf('const NAV_ITEMS'), src.indexOf('export function AppShell'))
  return [...block.matchAll(/\{\s*id:\s*'([a-z-]+)',\s*label:\s*'([^']+)'/g)].map((m) => ({
    id: m[1],
    label: m[2],
  }))
}

/** e2e 的映射表：`{ id: 'overview', nav: '总览', heading: '科研助手', ... }` */
function e2eSections(): Array<{ id: string; nav: string; heading: string }> {
  const src = read('e2e/sections.spec.ts')
  const block = src.slice(src.indexOf('const SECTIONS'), src.indexOf('// E2E 每次都是'))
  return [...block.matchAll(/\{\s*id:\s*'([a-z-]+)',\s*nav:\s*'([^']+)',\s*heading:\s*'([^']+)'/g)].map((m) => ({
    id: m[1],
    nav: m[2],
    heading: m[3],
  }))
}

/** 分区 id → 承载它标题的组件文件 */
const SECTION_FILES: Record<string, string> = {
  overview: 'src/components/sections/overview-section.tsx',
  papers: 'src/components/sections/papers-section.tsx',
  search: 'src/components/sections/search-section.tsx',
  topics: 'src/components/sections/topics-section.tsx',
  experiments: 'src/components/sections/experiments-section.tsx',
  planner: 'src/components/sections/planner-section.tsx',
  simlab: 'src/components/sections/sim-lab-section.tsx',
  writing: 'src/components/sections/writing-section.tsx',
  notes: 'src/components/sections/notes-section.tsx',
  methodology: 'src/components/sections/methodology-section.tsx',
  settings: 'src/components/sections/settings-section.tsx',
  docs: 'src/components/sections/docs-section.tsx',
}

/** 读某个分区实际渲染出来的标题（SectionHeader 的 title，或总览的 h1 题头） */
function actualHeading(id: string): string | null {
  const file = SECTION_FILES[id]
  if (!file) return null
  const src = read(file)
  const headerAt = src.indexOf('<SectionHeader')
  if (headerAt >= 0) {
    const m = src.slice(headerAt, headerAt + 600).match(/title="([^"]+)"/)
    if (m) return m[1]
  }
  const h1 = src.match(/<h1[^>]*>([^<]+)<\/h1>/)
  return h1 ? h1[1].trim() : null
}

describe('侧边栏 / 分区标题 / e2e 表三者的对齐', () => {
  it('NAV_ITEMS 与 e2e 的 SECTIONS：id 集合与顺序完全一致', () => {
    const nav = navItems().map((n) => n.id)
    const e2e = e2eSections().map((s) => s.id)
    expect(nav.length).toBeGreaterThanOrEqual(12)
    // 顺序也要求一致：侧边栏是按 NAV_ITEMS 顺序渲染的，e2e 顺带覆盖了「顺序没被改乱」
    expect(e2e).toEqual(nav)
  })

  it('e2e 里的 nav 文案与侧边栏 label 逐字一致（这条就是本轮踩的坑）', () => {
    const nav = new Map(navItems().map((n) => [n.id, n.label]))
    for (const s of e2eSections()) {
      expect(`${s.id}: ${nav.get(s.id)}`).toBe(`${s.id}: ${s.nav}`)
    }
  })

  it('e2e 里的 heading 能在该分区真正渲染出来的标题里匹配到', () => {
    // ⚠️ 用「包含」而不是「相等」：Playwright 的 `getByRole('heading', { name })` 默认是
    // **子串 + 忽略大小写**匹配（`exact: false`），总览那条又是 `toContainText('科研助手')` ——
    // 实际 h1 是「AI 通信组网科研助手」。这里的判据要与 e2e 的真实行为一致：
    // 目的是「保证 e2e 不会因为文案漂移而红」，不是规定标题该怎么起名。
    for (const s of e2eSections()) {
      const actual = actualHeading(s.id)
      expect({ id: s.id, matched: !!actual && actual.includes(s.heading), actual }).toEqual({
        id: s.id,
        matched: true,
        actual,
      })
    }
  })

  it('e2e 只按 data-section 的 id 找导航按钮，不再依赖可见文案', () => {
    for (const file of ['e2e/sections.spec.ts', 'e2e/workflows.spec.ts']) {
      const src = read(file)
      expect(src).toMatch(/\[data-section="\$\{id\}"\]|\[data-section="\$\{sectionId\}"\]/)
      // 旧的写法：按 role/name 找带中文文案的按钮 —— 文案一改就找不到
      expect(src).not.toMatch(/getByRole\('button',\s*\{\s*name:\s*new RegExp/)
    }
  })

  it('gotoSection 的调用点用的是 id（不是中文文案）', () => {
    const src = read('e2e/workflows.spec.ts')
    const calls = [...src.matchAll(/gotoSection\(page,\s*'([^']+)'\)/g)].map((m) => m[1])
    expect(calls.length).toBeGreaterThanOrEqual(3)
    const ids = new Set(navItems().map((n) => n.id))
    for (const c of calls) expect(`${c}:${ids.has(c)}`).toBe(`${c}:true`)
  })

  it('侧边栏按钮带 data-section、主内容区带 data-active-section（e2e 的抓手）', () => {
    const shell = read('src/components/app-shell.tsx')
    // 桌面端与移动端两处导航都要有
    expect(shell.match(/data-section=\{item\.id\}/g)?.length).toBe(2)
    expect(shell).toMatch(/data-active-section=\{activeSection\}/)
  })
})
