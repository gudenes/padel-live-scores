'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'padel.theme'
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} })
export const useTheme = () => useContext(Ctx)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  useEffect(() => {
    let stored: Theme | null = null
    try { stored = localStorage.getItem(KEY) as Theme | null } catch {}
    if (stored === 'light' || stored === 'dark') setTheme(stored)
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(KEY, theme) } catch {}
  }, [theme])
  const toggle = useCallback(() => setTheme(t => (t === 'light' ? 'dark' : 'light')), [])
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>
}
