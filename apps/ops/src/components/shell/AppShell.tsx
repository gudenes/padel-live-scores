'use client'
import { ThemeProvider } from './ThemeProvider'
import { BrandProvider } from './BrandProvider'
import { GlobalHeader } from './GlobalHeader'
import { IconSprite } from '../IconSprite'
import './shell.css'

export function AppShell({ children, userEmail = null }: { children: React.ReactNode; userEmail?: string | null }) {
  return (
    <ThemeProvider>
      <BrandProvider>
        <IconSprite />
        <div className="app horizontal-app">
          <GlobalHeader userEmail={userEmail} />
          <div className="shell">
            <main className="main">{children}</main>
          </div>
        </div>
      </BrandProvider>
    </ThemeProvider>
  )
}
