'use client'
import { useState } from 'react'
import { useTheme } from './ThemeProvider'
import Link from 'next/link'
import { HorizontalNav } from './HorizontalNav'
import { Icon } from '../IconSprite'
import { signOutAction } from '@/lib/actions/sign-out'
import { CommandPalette } from './CommandPalette'

export function GlobalHeader({ userEmail = null }: { userEmail?: string | null }) {
  const { theme, toggle } = useTheme()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const avatarLabel = userEmail ? userEmail.charAt(0).toUpperCase() : 'PN'
  return (
    <header className="gheader">
      <Link className="dual-brand" href="/today" aria-label="Padel Nachos and Padel Labs · Admin home">
        <img className="nachos-wordmark" src="/brand/padelnachos.png" alt="Padel Nachos" width="86" height="54" />
        <span className="brand-divider" aria-hidden="true" />
        <img className="labs-wordmark" src="/brand/padellabs.png" alt="Padel Labs" width="156" height="42" />
      </Link>
      <HorizontalNav />

      <label className="gsearch">
        <Icon id="search" />
        <input
          aria-label="Search admin"
          placeholder="Search matches, players…"
          readOnly
          onFocus={(e) => { e.currentTarget.blur(); window.dispatchEvent(new Event('ops:open-palette')) }}
          onClick={() => window.dispatchEvent(new Event('ops:open-palette'))}
        />
        <kbd>⌘K</kbd>
      </label>

      <div className="gright">
        <a className="iconbtn" href="/downloads/padel-nachos-scout-0.2.8.zip" download="padel-nachos-scout-0.2.8.zip" aria-label="Download scouting extension" title="Download Scout v0.2.8 · installation guide and Mac / Windows helpers">
          <Icon id="download" />
        </a>
        <span className="envpill"><span className="d" />Prod</span>
        <button className="iconbtn" onClick={toggle} aria-label="Toggle theme">
          <Icon id={theme === 'light' ? 'moon' : 'sun'} />
        </button>

        <div className="usermenu" onMouseLeave={() => setUserMenuOpen(false)}>
          <button
            className="avatar"
            aria-label="Open account menu"
            onClick={() => setUserMenuOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            title={userEmail ? `Signed in as ${userEmail}` : undefined}
          >
            {avatarLabel}
          </button>
          {userMenuOpen && (
            <div className="usermenudrop" role="menu">
              {userEmail && (
                <div className="um-h">
                  <span className="um-hl">Signed in as</span>
                  <span className="um-email">{userEmail}</span>
                </div>
              )}
              <form action={signOutAction}>
                <button type="submit" className="um-signout" role="menuitem">
                  <Icon id="share" />Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      <CommandPalette />
    </header>
  )
}
