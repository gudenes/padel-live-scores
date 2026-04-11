'use client'
// src/components/ThemeProvider.tsx
//
// Manages dark/light/system theme preference. Sets `data-theme`
// attribute on <html> so CSS variables in globals.css switch
// automatically. Persists user choice in localStorage.

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

export type ThemePreference = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

interface ThemeContextType {
  /** User's preference: dark, light, or system */
  theme: ThemePreference
  /** The actual applied theme after resolving system preference */
  resolvedTheme: ResolvedTheme
  /** Update the preference */
  setTheme: (t: ThemePreference) => void
}

const STORAGE_KEY = 'pn_theme'

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  resolvedTheme: 'dark',
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return getSystemTheme()
  return pref
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  if (resolved === 'dark') {
    html.setAttribute('data-theme', 'dark')
  } else {
    html.setAttribute('data-theme', 'light')
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Read initial preference — default to 'dark' (current app default)
  const [theme, setThemeState] = useState<ThemePreference>('dark')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark')

  // Initialize from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null
    const pref = stored && ['dark', 'light', 'system'].includes(stored) ? stored : 'dark'
    setThemeState(pref)
    const resolved = resolveTheme(pref)
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [])

  // Listen for system theme changes (when preference is 'system')
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const resolved = resolveTheme('system')
      setResolvedTheme(resolved)
      applyTheme(resolved)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = useCallback((pref: ThemePreference) => {
    setThemeState(pref)
    localStorage.setItem(STORAGE_KEY, pref)
    const resolved = resolveTheme(pref)
    setResolvedTheme(resolved)
    applyTheme(resolved)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
