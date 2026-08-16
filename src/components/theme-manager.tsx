'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'

export function ThemeManager() {
  const theme = useAppStore((s) => s.theme)
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])
  return null
}
