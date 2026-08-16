'use client'

import { AppShell } from '@/components/app-shell'
import { OverviewSection } from '@/components/sections/overview-section'
import { PapersSection } from '@/components/sections/papers-section'
import { SearchSection } from '@/components/sections/search-section'
import { TopicsSection } from '@/components/sections/topics-section'
import { ExperimentsSection } from '@/components/sections/experiments-section'
import { PlannerSection } from '@/components/sections/planner-section'
import { WritingSection } from '@/components/sections/writing-section'
import { NotesSection } from '@/components/sections/notes-section'
import { MethodologySection } from '@/components/sections/methodology-section'
import { SimLabSection } from '@/components/sections/sim-lab-section'
import { SettingsSection } from '@/components/sections/settings-section'
import { useAppStore } from '@/lib/store'

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
    </AppShell>
  )
}
