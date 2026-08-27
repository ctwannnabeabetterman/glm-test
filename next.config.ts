import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 桌面端（Electron）打包用：额外产出自包含 server 到 .next/standalone，
  // 不影响 npm start / CI 的常规构建产物
  output: "standalone",
  // Next 的 outputFileTracing 漏追了 xlsx（SheetJS）：导致 standalone 缺 node_modules/xlsx，
  // 桌面版 /api/notes/export/xlsx 会 Cannot find module。显式把该包纳入 standalone 产物。
  outputFileTracingIncludes: {
    "/api/notes/export/xlsx": ["./node_modules/xlsx/**/*"],
  },
};

export default nextConfig;
