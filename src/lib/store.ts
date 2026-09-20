import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_RESULT_DENSITY, normalizeResultDensity, type ResultDensity } from '@/lib/result-density'
import {
  DEFAULT_CITATION_STYLE,
  normalizeCitationStyle,
  type CitationStyle,
} from '@/lib/writing/citation-styles'

export type Section =
  | 'overview'
  | 'papers'
  | 'search'
  | 'topics'
  | 'experiments'
  | 'planner'
  | 'writing'
  | 'notes'
  | 'methodology'
  | 'simlab'
  | 'settings'
  | 'docs'

/**
 * 「AI 综述 → 写作工作台」的一次性投递。
 *
 * 为什么用 store 而不是让用户自己复制粘贴：综述面板产出的正文里带的是
 * `[@paperId]` 标记，**只有写作工作台能把它们解析成编号与参考文献表**。
 * 复制粘贴这条链路是通的，但要多三步（复制 → 切页 → 找章节 → 粘贴到光标），
 * 而且粘错章节很常见。投递把这几步并为一次点击。
 *
 * 刻意**不持久化**（见下面的 partialize）：这是一次会话内的待办，
 * 不该在重启后突然冒出一段要插入的正文 —— 那比丢掉更让人困惑。
 */
export interface DraftInbox {
  /** 要插入稿件的 markdown（含 `[@paperId]` 标记） */
  content: string
  /** 建议的章节标题 */
  title: string
  /** 投递时间戳，仅用于展示 */
  at: number
}

interface AppState {
  activeSection: Section
  theme: 'light' | 'dark'
  sidebarCollapsed: boolean
  /** AI 结果的呈现密度（紧凑 / 标准 / 论文式），在设置页可选 */
  resultDensity: ResultDensity
  /** 参考文献著录格式（IEEE / GB/T 7714），在写作工作台可切换 */
  citationStyle: CitationStyle
  draftInbox: DraftInbox | null
  setSection: (s: Section) => void
  toggleTheme: () => void
  setSidebarCollapsed: (v: boolean) => void
  setResultDensity: (d: ResultDensity) => void
  setCitationStyle: (s: CitationStyle) => void
  sendDraftToWriting: (payload: { content: string; title: string }) => void
  /** 取出并清空待插入的综述草稿；没有则返回 null（写作工作台在插入完成后调用） */
  takeDraftInbox: () => DraftInbox | null
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeSection: 'overview',
      theme: 'light',
      sidebarCollapsed: false,
      resultDensity: DEFAULT_RESULT_DENSITY,
      citationStyle: DEFAULT_CITATION_STYLE,
      draftInbox: null,
      setSection: (s) => set({ activeSection: s }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      // 收敛一道：调用方理论上只传合法值，但持久化/外部调用可能塞进脏值，
      // 脏值会让 <html> 上的属性与任何 CSS 规则都对不上（表现为「选了没反应」）。
      setResultDensity: (d) => set({ resultDensity: normalizeResultDensity(d) }),
      // 同理：脏样式值会让「导出用的样式」与「预览显示用的样式」不一致，
      // 用户看到的是 A、拿到的是 B —— 比报错更难发现。
      setCitationStyle: (s) => set({ citationStyle: normalizeCitationStyle(s) }),
      sendDraftToWriting: ({ content, title }) =>
        set({ draftInbox: { content, title, at: Date.now() } }),
      takeDraftInbox: () => {
        const current = get().draftInbox
        if (current) set({ draftInbox: null })
        return current
      },
    }),
    {
      name: 'ai-research-store',
      // 只持久化「用户偏好」，不持久化「一次性的待办投递」。
      // 老版本存的 JSON 里没有 citationStyle，读取时由默认值兜底（zustand 的浅合并）。
      partialize: (state) => ({
        activeSection: state.activeSection,
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        resultDensity: state.resultDensity,
        citationStyle: state.citationStyle,
      }),
    }
  )
)
