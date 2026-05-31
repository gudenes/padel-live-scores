'use client'
import { useEffect, useState } from 'react'
import { ThemeProvider } from './ThemeProvider'
import { BrandProvider } from './BrandProvider'
import { GlobalHeader } from './GlobalHeader'
import { Rail } from './Rail'
import { IconSprite } from '../IconSprite'
import './shell.css'

export function AppShell({ children, userEmail = null }: { children: React.ReactNode; userEmail?: string | null }) {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => { try { if (localStorage.getItem('ops.rail.collapsed') === '1') setCollapsed(true) } catch {} }, [])
  useEffect(() => { try { localStorage.setItem('ops.rail.collapsed', collapsed ? '1' : '0') } catch {} }, [collapsed])
  return (
    <ThemeProvider>
      <BrandProvider>
        <IconSprite />
        <div className={`app ${collapsed ? 'collapsed' : ''}`}>
          <GlobalHeader userEmail={userEmail} />
          <div className="shell">
            <Rail collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
            <main className="main">{children}</main>
          </div>
        </div>
      </BrandProvider>
    </ThemeProvider>
  )
}
