'use client'
import { ThemeProvider } from './ThemeProvider'
import { BrandProvider } from './BrandProvider'
import { GlobalHeader } from './GlobalHeader'
import { IconSprite } from '../IconSprite'
import './shell.css'

export function AppShell({ children, userEmail = null, scoped = false }: { children: React.ReactNode; userEmail?: string | null; scoped?: boolean }) {
  return (
    <ThemeProvider>
      <BrandProvider>
        <IconSprite />
        <div className="app horizontal-app">
          <GlobalHeader userEmail={userEmail} scoped={scoped} />
          <div className="shell">
            <main className="main">{children}</main>
          </div>
        </div>
      </BrandProvider>
    </ThemeProvider>
  )
}
