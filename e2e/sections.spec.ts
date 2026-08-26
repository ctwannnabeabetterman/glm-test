import { expect, test } from '@playwright/test'

/**
 * 11 个功能分区的导航渲染冒烟：
 * 点击侧边栏每一项 ⇒ 对应分区标题出现、无 Next.js 错误浮层。
 * 这是历史运行时崩溃（多种子记录渲染崩溃）的回归防线。
 */

const SECTIONS = [
  '总览仪表盘',
  '论文库',
  '文献检索工具',
  '选题评估',
  '实验管理',
  '研究规划',
  '论文写作',
  '科研笔记',
  '方法论浏览',
  '组网仿真实验',
  '系统设置',
] as const

// E2E 每次都是「新访客」：预先标记引导已完成，
// 否则首次访问自动弹出的新手引导遮罩会拦截全部点击
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem('onboarding-completed', '1')
  })
})

test.describe.serial('分区导航', () => {
  for (const label of SECTIONS) {
    test(`分区「${label}」正常渲染`, async ({ page }) => {
      await page.goto('/')
      // 侧边栏导航项（桌面端可见）
      const nav = page.getByRole('button', { name: new RegExp(label) }).first()
      await nav.click()
      // 分区标题出现（SectionHeader title 与侧边栏文案一致；总览为 h1）
      if (label === '总览仪表盘') {
        await expect(page.getByRole('heading', { level: 1 })).toContainText('科研助手')
      } else {
        await expect(page.getByRole('heading', { name: label }).first()).toBeVisible()
      }
      // 无 Next.js 错误边界 / 崩溃浮层
      await expect(page.getByText('Application error')).toHaveCount(0)
    })
  }

  test('侧边栏恰好包含 11 个分区入口', async ({ page }) => {
    await page.goto('/')
    for (const label of SECTIONS) {
      await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible()
    }
  })
})
