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
  /** 要插入稿件的 markdown（可以只是 `[@paperId]`，也可以是一整节综述） */
  content: string
  /** 建议的章节标题（`mode='section'` 时用作新章节名） */
  title: string
  /**
   * `section` = 插成**新章节**（综述草稿用）；
   * `append`  = 追加到某个**已有章节的末尾**（插入引用、补一段话用）。
   *
   * 为什么要有两种：单条 `[@p1]` 也走「新建章节」的话，用户会看到稿件里
   * 凭空多出一个只含一个引用标记的章节 —— 比不插入更糟。
   */
  mode: 'section' | 'append'
  /** `mode='append'` 时优先匹配的章节名（例如 `Related Work`）；匹配不到会自行回落 */
  targetTitle?: string
  /** 投递时间戳，仅用于展示 */
  at: number
}

/**
 * 「引文 → 论文库」的一次性投递：在写作页点某条引文的「证据」，跳到论文库看这一篇。
 *
 * 与 `draftInbox` 同属一类：**一次会话内的待办**，所以同样不进 `partialize` ——
 * 重启后自动跳到某篇论文，比不动更让人困惑。
 *
 * 为什么不由调用方自己 `setSection('papers')` 就完事：光切页还差一步「选中那一篇」，
 * 而「选中」是论文库页的内部状态，外面够不着。投递把它变成一次点击能完成的事
 * （与引用投递同样的理由：跳页不是可选步骤，不跳用户会以为按钮没反应）。
 */
export interface PaperInbox {
  /** 要跳过去查看的论文 id */
  paperId: string
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
  paperInbox: PaperInbox | null
  setSection: (s: Section) => void
  toggleTheme: () => void
  setSidebarCollapsed: (v: boolean) => void
  setResultDensity: (d: ResultDensity) => void
  setCitationStyle: (s: CitationStyle) => void
  sendDraftToWriting: (payload: {
    content: string
    title: string
    mode?: 'section' | 'append'
    targetTitle?: string
  }) => void
  /** 取出并清空待插入的内容；没有则返回 null（写作工作台在插入完成后调用） */
  takeDraftInbox: () => DraftInbox | null
  /** 跳到论文库并选中某篇（投递 + 切页一次完成） */
  openPaper: (paperId: string) => void
  /** 取出并清空待查看的论文；没有则返回 null（论文库页在选中后调用） */
  takePaperInbox: () => PaperInbox | null
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
      paperInbox: null,
      setSection: (s) => set({ activeSection: s }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      // 收敛一道：调用方理论上只传合法值，但持久化/外部调用可能塞进脏值，
      // 脏值会让 <html> 上的属性与任何 CSS 规则都对不上（表现为「选了没反应」）。
      setResultDensity: (d) => set({ resultDensity: normalizeResultDensity(d) }),
      // 同理：脏样式值会让「导出用的样式」与「预览显示用的样式」不一致，
      // 用户看到的是 A、拿到的是 B —— 比报错更难发现。
      setCitationStyle: (s) => set({ citationStyle: normalizeCitationStyle(s) }),
      sendDraftToWriting: ({ content, title, mode, targetTitle }) =>
        set({ draftInbox: { content, title, mode: mode ?? 'section', targetTitle, at: Date.now() } }),
      takeDraftInbox: () => {
        const current = get().draftInbox
        if (current) set({ draftInbox: null })
        return current
      },
      openPaper: (paperId) =>
        set({ paperInbox: { paperId, at: Date.now() }, activeSection: 'papers' }),
      takePaperInbox: () => {
        const current = get().paperInbox
        if (current) set({ paperInbox: null })
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
