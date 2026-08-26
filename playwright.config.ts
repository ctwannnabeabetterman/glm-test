import { defineConfig, devices } from '@playwright/test'

/**
 * E2E 配置 —— 对运行中的应用做真实浏览器测试。
 * 本地：复用已在 3000 端口运行的 dev server（reuseExistingServer）。
 * CI：自动 `db:push` 后启动全新 dev server。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // 共享同一 SQLite 库，串行避免相互干扰
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'zh-CN',
  },
  webServer: process.env.CI
    ? {
        command: 'npm run db:push -- --skip-generate && npm run dev',
        url: 'http://localhost:3000',
        timeout: 240_000,
        reuseExistingServer: false,
      }
    : undefined,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
