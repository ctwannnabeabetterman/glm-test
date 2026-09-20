import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { UpdateNotifier } from "@/components/update-notifier";

/* 字体说明：本应用是离线桌面客户端，不能依赖 next/font/google 拉取字体
   （断网时会拿不到字体文件）。故全部使用系统字体栈，
   在 globals.css 里通过 --font-ui / --font-body / --font-mono-stack 定义。
   中文优先思源系列（Noto Serif SC / Noto Sans SC），Windows 自带。 */

export const metadata: Metadata = {
  title: "AI Network Lab · 智能网络科研工作台",
  description: "AI 通信组网方向硕士研究生科研全流程辅助平台 — 选题、文献、实验、写作、投稿一站式管理",
  keywords: ["AI", "通信", "组网", "科研", "DRL", "LSTM", "论文阅读", "Zotero", "IEEE"],
  authors: [{ name: "AI Research Lab" }],
  /* 图标必须走本地资源。
     原先指向 https://z-cdn.chatglm.cn/... 的远程 SVG，有两个问题：
       ① 这是离线桌面客户端 —— 断网时那次请求必然失败，纯属无谓等待；
       ② 壳层对渲染进程施加的 CSP 只允许同源资源（img-src 'self' data:），
          远程图标会被直接拦掉，控制台每次启动刷一条 CSP 违规。
     本地 public/logo.svg 随包分发，两个问题一并消除。 */
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const stored = localStorage.getItem('ai-research-store');
                if (stored) {
                  const parsed = JSON.parse(stored);
                  const theme = parsed?.state?.theme;
                  if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                  }
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        <UpdateNotifier />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
