'use client'

/**
 * 页面入口 —— 12 个功能页共用一个客户端入口，按侧边栏选中的 section 渲染其一。
 *
 * ⚠️ 这里**必须**用 `next/dynamic` 而不是静态 import（2026-09-20 性能改造）。
 *
 * 原因：这是个单页工作台，12 个 section 的**代码原本全部静态引入** ⇒ 打包器会
 * 把它们连同各自的重依赖（recharts / react-markdown / 各类表格与编辑器）压进
 * 同一个入口 chunk。用户打开应用时，哪怕只想看首页，也得先下载并解析**全部**
 * 12 个页面的 JS。实测这让首屏 JS 达到 1.8 MB，其中 recharts 一块就 1.1 MB。
 *
 * 改成 `next/dynamic` 之后每个 section 变成独立 chunk，只在真正切过去时才请求。
 * 首屏只需要「总览」一个 chunk，其余 11 个在点击时按需拉取
 * （点得快时会有极短的白态，由下面的 loading 占位兜住）。
 *
 * 注意 `ssr: false`：本应用是 Electron 壳 + 本地 Next 服务，页面本身就是纯客户端
 * 交互（数据全来自 /api 且依赖 localStorage 里的持久化状态），预渲染没有收益。
 */

import dynamic from 'next/dynamic'
import { AppShell } from '@/components/app-shell'
import { useAppStore } from '@/lib/store'

/** 切换页面时的轻量占位：保持版心与留白，避免布局跳动 */
function SectionFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-3 w-24 rounded-sm bg-muted" />
      <div className="h-8 w-2/5 rounded-sm bg-muted" />
      <div className="h-px w-full bg-border" />
      <div className="space-y-2 pt-2">
        <div className="h-3 w-full rounded-sm bg-muted" />
        <div className="h-3 w-11/12 rounded-sm bg-muted" />
        <div className="h-3 w-3/4 rounded-sm bg-muted" />
      </div>
    </div>
  )
}

const OverviewSection = dynamic(
  () => import('@/components/sections/overview-section').then((m) => m.OverviewSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const PapersSection = dynamic(
  () => import('@/components/sections/papers-section').then((m) => m.PapersSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const SearchSection = dynamic(
  () => import('@/components/sections/search-section').then((m) => m.SearchSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const TopicsSection = dynamic(
  () => import('@/components/sections/topics-section').then((m) => m.TopicsSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const ExperimentsSection = dynamic(
  () => import('@/components/sections/experiments-section').then((m) => m.ExperimentsSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const PlannerSection = dynamic(
  () => import('@/components/sections/planner-section').then((m) => m.PlannerSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const WritingSection = dynamic(
  () => import('@/components/sections/writing-section').then((m) => m.WritingSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const NotesSection = dynamic(
  () => import('@/components/sections/notes-section').then((m) => m.NotesSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const MethodologySection = dynamic(
  () => import('@/components/sections/methodology-section').then((m) => m.MethodologySection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const SimLabSection = dynamic(
  () => import('@/components/sections/sim-lab-section').then((m) => m.SimLabSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const SettingsSection = dynamic(
  () => import('@/components/sections/settings-section').then((m) => m.SettingsSection),
  { ssr: false, loading: () => <SectionFallback /> }
)
const DocsSection = dynamic(
  () => import('@/components/sections/docs-section').then((m) => m.DocsSection),
  { ssr: false, loading: () => <SectionFallback /> }
)

export default function Home() {
  const activeSection = useAppStore((s) => s.activeSection)

  return (
    <AppShell>
      {activeSection === 'overview' && <OverviewSection />}
      {activeSection === 'papers' && <PapersSection />}
      {activeSection === 'search' && <SearchSection />}
      {activeSection === 'topics' && <TopicsSection />}
      {activeSection === 'experiments' && <ExperimentsSection />}
      {activeSection === 'planner' && <PlannerSection />}
      {activeSection === 'writing' && <WritingSection />}
      {activeSection === 'notes' && <NotesSection />}
      {activeSection === 'methodology' && <MethodologySection />}
      {activeSection === 'simlab' && <SimLabSection />}
      {activeSection === 'settings' && <SettingsSection />}
      {activeSection === 'docs' && <DocsSection />}
    </AppShell>
  )
}
