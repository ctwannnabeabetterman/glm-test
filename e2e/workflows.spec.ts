import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * 三条关键用户工作流：
 *  1. 论文库 —— UI 完整走「添加论文」对话框（自清理）
 *  2. 组网仿真 —— 点「运行实验」⇒ 指标卡出现且确定性引擎返回合法数值
 *  3. 系统设置 —— 预设下拉渲染；无 Key 时「测试连通」给出中文引导
 */

const UNIQUE_TITLE = `__e2e_playwright_paper_${Date.now()}__`

// 跳过新手引导遮罩（E2E 每次都是无痕新访客）
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem('onboarding-completed', '1')
  })
})

async function gotoSection(page: Page, label: string) {
  await page.goto('/')
  await page.getByRole('button', { name: new RegExp(label) }).first().click()
}

test.describe.serial('关键工作流', () => {
  test('论文库：添加论文 → 列表可见 → API 清理', async ({ page, request }) => {
    await gotoSection(page, '论文库')

    await page.getByRole('button', { name: '添加论文' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder('Deep Reinforcement Learning for...').fill(UNIQUE_TITLE)
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog).not.toBeVisible()

    // 列表出现新论文（React Query / useFetch 刷新后）
    await expect(page.getByText(UNIQUE_TITLE).first()).toBeVisible()

    // 清理：找到刚建的记录并删除，不留测试数据
    const papers = (await (await request.get('/api/papers')).json()) as { id: string; title: string }[]
    const created = papers.filter((p) => p.title === UNIQUE_TITLE)
    expect(created.length).toBeGreaterThan(0)
    for (const p of created) {
      const del = await request.delete(`/api/papers/${p.id}`)
      expect(del.ok()).toBeTruthy()
    }
  })

  test('组网仿真：运行实验 → 指标卡出现合法交付率', async ({ page }) => {
    await gotoSection(page, '组网仿真实验')
    await page.getByRole('button', { name: '运行实验' }).first().click()
    // 引擎在服务端毫秒级完成；等待指标卡渲染
    const rateCard = page.getByText('交付率', { exact: false }).first()
    await expect(rateCard).toBeVisible({ timeout: 30_000 })
    // 交付率为合法百分数（如 "96.1%" 或 "35.3%"）
    const cardText = await page.locator('text=/^\\d+(\\.\\d+)?%$/').first().textContent()
    expect(cardText).toMatch(/^\d+(\.\d+)?%$/)
  })

  test('系统设置：预设渲染；无 Key 时连通测试给出中文引导', async ({ page }) => {
    await gotoSection(page, '系统设置')
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible()
    await expect(page.getByText('服务商').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '测试连通' })).toBeVisible()

    // 仅当当前环境未配置 Key 时执行降级路径断言（不触碰已配置的本地 Key）
    const status = await (await page.request.get('/api/settings/llm')).json()
    if (!status.hasKey) {
      await page.getByRole('button', { name: '测试连通' }).click()
      await expect(page.getByText(/未配置 API Key/).first()).toBeVisible({ timeout: 15_000 })
    }
  })
})
