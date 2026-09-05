import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  | 'inetlab'
  | 'settings'
  | 'docs'

interface AppState {
  activeSection: Section
  theme: 'light' | 'dark'
  sidebarCollapsed: boolean
  setSection: (s: Section) => void
  toggleTheme: () => void
  setSidebarCollapsed: (v: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeSection: 'overview',
      theme: 'light',
      sidebarCollapsed: false,
      setSection: (s) => set({ activeSection: s }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    { name: 'ai-research-store' }
  )
)
