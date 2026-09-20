import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 本机验证脚本（.recon/*）用无头 Edge 打 127.0.0.1 抓图。Next 16 默认拒绝
  // 非 localhost 来源的开发资源请求，会导致「页面 200 但 JS 全被拦」——
  // 表现为截图里只有空壳 HTML、localStorage 注入后仍停在同一页，
  // 极易被误判成「样式/状态没生效」。这里显式放行本地回环地址。
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // 把版本号在构建期注入前端。顶栏原先写死「v1.0」，发到 1.2.4 也不变，属于长期不被发现的
  // 显示错误 —— 版本号只应该有一个来源（package.json），不要在前端再抄一份。
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
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
  experimental: {
    // 关掉服务端 source map。
    //
    // 默认是开启的，于是 .next/server 下每个 route 都会多出一个 .js.map
    // （实测 191 个），而这些 map 里带着 **完整的原始 TypeScript 源码**
    // （sourcesContent 字段内嵌全文）。对一个要防止逆向的桌面客户端来说，
    // 这等于把全部后端逻辑连同注释一起送出去。
    //
    // 关掉的收益是双份的：
    //   · 打包产物少约 190 个文件、体积与解压时间都下降；
    //   · 逆向者拿不到「带注释的原始实现」，只能读压缩后的产物。
    //
    // ⚠️ desktop/prepare-standalone.js 的 pruneStandalone() 里还有一道
    //    `*.map` 兜底删除（防止这个开关将来失效），两道一起才稳妥。
    serverSourceMaps: false,
  },
};

export default nextConfig;
