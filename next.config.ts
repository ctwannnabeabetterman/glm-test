import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 桌面端（Electron）打包用：额外产出自包含 server 到 .next/standalone，
  // 不影响 npm start / CI 的常规构建产物
  output: "standalone",
  serverExternalPackages: ['pdfkit'],
  outputFileTracingExcludes: {
    '*': [
      './release/**/*',
      './release-*/**/*',
      './resources/**/*',
      './.git/**/*',
      // 以下目录不进运行时，但 Next 的 tracing 会按需把它们拷进 .next/standalone。
      // 实测 test-results 曾被拷入 366 MB，必须在这里挡住（desktop/prepare-standalone.js
      // 的 pruneStandalone 还有一道白名单兜底）。
      './test-results/**/*',
      './playwright-report/**/*',
      './e2e/**/*',
      './tests/**/*',
      './docs/**/*',
      './.github/**/*',
      './db/**/*',
      './*.db',
      './desktop-test.db',
    ],
  },
  // Next 的 outputFileTracing 漏追了 xlsx（SheetJS）：导致 standalone 缺 node_modules/xlsx，
  // 桌面版 /api/notes/export/xlsx 会 Cannot find module。显式把该包纳入 standalone 产物。
  outputFileTracingIncludes: {
    "/api/notes/export/xlsx": ["./node_modules/xlsx/**/*"],
    "/api/notes/export/[id]": ["./node_modules/xlsx/**/*"],
  },
};

export default nextConfig;
