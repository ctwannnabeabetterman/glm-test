import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 仿真引擎测试全部是纯函数确定性断言，无 IO / 无定时器
    testTimeout: 30_000,
  },
})
