import { expect, test } from '@playwright/test'

type UpdatePayload = {
  state: string
  current?: string
  version?: string
  reason?: string
  message?: string
  percent?: number
  file?: string
}

type UpdateBridge = Window & {
  __emitUpdate: (payload: UpdatePayload) => void
  __resolveInfo: () => void
  __updateActions: string[]
  __listenerCount: () => number
}

async function installBridge(context: import('@playwright/test').BrowserContext, initial: UpdatePayload, deferInfo = false) {
  await context.addInitScript(({ snapshot, deferred }) => {
    localStorage.setItem('onboarding-completed', '1')
    localStorage.setItem('ai-research-seeded', '1')
    const client = window as typeof window & {
      electronAppInfo: () => Promise<unknown>
      electronCheckUpdates: () => Promise<unknown>
      electronDownloadUpdate: () => Promise<unknown>
      electronInstallUpdate: () => Promise<unknown>
      electronOnUpdateStatus: (fn: (p: typeof snapshot) => void) => number
      electronOffUpdateStatus: (id: number) => void
      __emitUpdate: (p: typeof snapshot) => void
      __resolveInfo: () => void
      __updateActions: string[]
      __listenerCount: () => number
    }
    const listeners = new Map<number, (p: typeof snapshot) => void>()
    const resolvers: Array<(info: unknown) => void> = []
    client.__updateActions = []
    client.__listenerCount = () => listeners.size
    client.__emitUpdate = (payload) => { for (const fn of listeners.values()) fn(payload) }
    client.__resolveInfo = () => {
      for (const resolve of resolvers.splice(0)) resolve({ ok: true, version: '1.3.14', isPackaged: true, updateStatus: snapshot })
    }
    client.electronAppInfo = () => deferred
      ? new Promise((resolve) => resolvers.push(resolve))
      : Promise.resolve({ ok: true, version: '1.3.14', isPackaged: true, updateStatus: snapshot })
    client.electronOnUpdateStatus = (fn) => {
      const id = listeners.size + 1
      listeners.set(id, fn)
      return id
    }
    client.electronOffUpdateStatus = (id) => { listeners.delete(id) }
    client.electronCheckUpdates = async () => ({ ok: true, current: '1.3.14', latest: '1.4.1', hasUpdate: true })
    client.electronDownloadUpdate = async () => {
      client.__updateActions.push('download')
      client.__emitUpdate({ state: 'downloading', current: '1.3.14', percent: 20 })
      return { ok: true }
    }
    client.electronInstallUpdate = async () => {
      client.__updateActions.push('install')
      return { ok: true }
    }
  }, { snapshot: initial, deferred: deferInfo })
}

test('启动前已有新版本：恢复常驻提醒、下载进度及安装入口', async ({ page, context }) => {
  await installBridge(context, { state: 'available', current: '1.3.14', version: '1.4.1' })
  await page.goto('/')
  const banner = page.locator('[role="status"]').filter({ hasText: '发现新版本 1.4.1' }).first()
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: '下载更新' }).click()
  await expect(page.locator('[role="status"]').filter({ hasText: '正在下载更新 20%' }).first()).toBeVisible()
  await page.evaluate(() => (window as unknown as UpdateBridge).__emitUpdate({
    state: 'downloaded', current: '1.3.14', version: '1.4.1', file: 'C:/temp/AI-Network-Lab-Setup-1.4.1.exe',
  }))
  const ready = page.locator('[role="status"]').filter({ hasText: '新版本 1.4.1 已就绪' }).first()
  await expect(ready).toBeVisible()
  await expect(ready).toContainText('安装包已存于')
  await ready.getByRole('button', { name: '立即重启并安装' }).click()
  expect(await page.evaluate(() => (window as unknown as UpdateBridge).__updateActions)).toEqual(['download', 'install'])
})

test('更新失败在全局可见，点击提示可进入设置重试', async ({ page, context }) => {
  await installBridge(context, {
    state: 'error', current: '1.3.14', reason: 'network', message: '自动检查更新失败：无法连接更新源',
  })
  await page.goto('/')
  const banner = page.locator('[role="status"]').filter({ hasText: '更新未完成' }).first()
  await expect(banner).toContainText('无法连接更新源')
  await banner.getByRole('button', { name: '查看并重试' }).click()
  await expect(page.locator('[data-active-section="settings"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '检查更新' })).toBeVisible()
  await expect(page.getByText('自动检查更新失败：无法连接更新源').first()).toBeVisible()
})

test('设置页和全局条不会被迟到的 app-info 旧快照覆盖', async ({ page, context }) => {
  await installBridge(context, { state: 'available', current: '1.3.14', version: '1.4.1' }, true)
  await page.goto('/')
  await page.locator('[data-section="settings"]').first().click()
  await expect(page.locator('[data-active-section="settings"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as UpdateBridge).__listenerCount())).toBe(2)
  await page.evaluate(() => {
    const bridge = window as unknown as UpdateBridge
    bridge.__emitUpdate({ state: 'downloaded', current: '1.3.14', version: '1.4.1' })
    bridge.__resolveInfo()
  })
  await expect(page.locator('[role="status"]').filter({ hasText: '新版本 1.4.1 已就绪' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '立即重启并安装' })).toHaveCount(2)
})
