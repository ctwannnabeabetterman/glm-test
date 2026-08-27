import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 桌面端（Electron）打包用：额外产出自包含 server 到 .next/standalone，
  // 不影响 npm start / CI 的常规构建产物
  output: "standalone",
};

export default nextConfig;
