import { expect, test } from '@playwright/test'

/**
 * 全部功能分区的导航渲染冒烟：
 * 点击侧边栏每一项 ⇒ 对应分区标题出现、无 Next.js 错误浮层。
 * 这是历史运行时崩溃（多种子记录渲染崩溃）的回归防线。
 *
 * ⚠️ 2026-09-21 重写：这套断言曾经**从 v1.3.7 起红了四版都没人发现**。
 * 起因很平常 —— 1.3.7 把侧边栏文案缩短了（「总览仪表盘」→「总览」、「组网仿真实验」→「组网仿真」
 * 等 5 处），而这套用例**按可见文案找按钮**（`getByRole('button', { name: /总览仪表盘/ })`），
 * 于是第一个用例就 120s 超时、serial 模式下后面 13 个根本没跑；而 `release.yml` 不跑 e2e，
 * Release 一路绿 ⇒ CI 这个信号整整四版是失效的。
 *
 * 现在改成：
 *  1. **按 `data-section` 找按钮**（`app-shell.tsx` 上的稳定钩子），文案再改也不会找不到；
 *  2. 标题断言用各分区的 `SectionHeader` 实际标题（与侧边栏文案本来就不同，见下表）；
 *  3. 新增 `tests/lib/e2e-nav-sync.test.ts`：把这张表与源码（NAV_ITEMS / SectionHeader）**逐字对齐**，
 *     以后再改文案会在**本机单测**就红，而不是等到 CI 悄悄红四版。
 */

/**
 * id 必须与 `app-shell.tsx` 的 NAV_ITEMS 逐字一致；nav 是侧边栏文案，heading 是该分区标题。
 *
 * ⚠️ 用显式类型而不是 `as const`：`as const` 会把它变成「字面量联合」，
 * 而 `isH1` 只存在于其中一条上 —— 解构时会报 TS2339（property does not exist on type ...）。
 * 这里的目的是「一张可读的表」，不需要字面量收窄。
 */
interface SectionCase {
  id: string
  /** 侧边栏文案（用于顺带核对渲染出来的文字） */
  nav: string
  /** 该分区真正渲染出来的标题（总览是 h1 题头，其余是 SectionHeader 标题） */
  heading: string
  /** 总览的标题是 h1 题头，断言方式不同 */
  isH1?: boolean
}

const SECTIONS: SectionCase[] = [
  { id: 'overview', nav: '总览', heading: '科研助手', isH1: true },
  { id: 'papers', nav: '论文库', heading: '论文库' },
  { id: 'search', nav: '文献检索', heading: '文献检索工具' },
  { id: 'topics', nav: '选题评估', heading: '选题评估' },
  { id: 'experiments', nav: '实验管理', heading: '实验管理' },
  { id: 'planner', nav: '研究规划', heading: '研究规划' },
  { id: 'simlab', nav: '组网仿真', heading: '组网仿真实验' },
  { id: 'writing', nav: '论文写作', heading: '论文写作' },
  { id: 'notes', nav: '科研笔记', heading: '科研笔记' },
  { id: 'methodology', nav: '方法论', heading: '方法论浏览' },
  { id: 'settings', nav: '设置', heading: '系统设置' },
  { id: 'docs', nav: '使用说明', heading: '使用说明' },
]

// E2E 每次都是「新访客」：预先标记引导已完成，
// 否则首次访问自动弹出的新手引导遮罩会拦截全部点击
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem('onboarding-completed', '1')
  })
})

test.describe.serial('分区导航', () => {
  for (const { id, heading, isH1 } of SECTIONS) {
    test(`分区「${heading}」正常渲染`, async ({ page }) => {
      await page.goto('/')
      // 侧边栏导航项（桌面端可见）—— 按 data-section 找，不依赖可见文案
      await page.locator(`[data-section="${id}"]`).first().click()
      // 主内容区切到了该分区
      await expect(page.locator(`[data-active-section="${id}"]`)).toBeVisible()
      // 分区标题出现（总览是 h1 题头，其余是 SectionHeader 的标题）
      if (isH1) {
        await expect(page.getByRole('heading', { level: 1 })).toContainText(heading)
      } else {
        await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible()
      }
      // 无 Next.js 错误边界 / 崩溃浮层
      await expect(page.getByText('Application error')).toHaveCount(0)
    })
  }

  test(`侧边栏包含全部 ${SECTIONS.length} 个分区入口`, async ({ page }) => {
    await page.goto('/')
    for (const { id, nav } of SECTIONS) {
      const entry = page.locator(`[data-section="${id}"]`).first()
      await expect(entry).toBeVisible()
      // 文案也核一下（文案本身有 e2e-nav-sync 单测守着，这里顺带确认渲染出来的是它）
      await expect(entry).toContainText(nav)
    }
  })
})
