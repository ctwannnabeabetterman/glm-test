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
    // 必须显式用 threads 池：默认的 forks（子进程）池在本项目里跑完全部用例后
    // 进程不会退出（测试全绿却一直挂着），本地会白等、CI 会一直挂到 job 超时，
    // 导致发布流水线永远到不了「产出安装包」那一步。实测 threads 池 3/3 次稳定退出。
    pool: 'threads',
  },
})
