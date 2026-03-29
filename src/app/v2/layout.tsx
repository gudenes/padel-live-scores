'use client'
// src/app/v2/layout.tsx
// Shell for all /v2/* pages — provides the fixed bottom nav.
// Future pages (Ranking, Tournaments) automatically inherit it just by adding the route.

import { usePathname } from 'next/navigation'
import Link from 'next/link'

function HomeIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
}

function MatchesIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M2 12h20"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  )
}

function RankingIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
    </svg>
  )
}

function TournamentsIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
    </svg>
  )
}

function FeedIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--color-accent)' : 'var(--text-faint)'
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11a9 9 0 0 1 9 9"/>
      <path d="M4 4a16 16 0 0 1 16 16"/>
      <circle cx="5" cy="19" r="1" fill={c}/>
    </svg>
  )
}

const TABS = [
  { href: '/v2',             label: 'Home',        Icon: HomeIcon },
  { href: '/v2/matches',     label: 'Matches',     Icon: MatchesIcon },
  { href: '/v2/feed',        label: 'Feed',        Icon: FeedIcon },
  { href: '/v2/ranking',     label: 'Ranking',     Icon: RankingIcon },
  { href: '/v2/tournaments', label: 'Tournaments', Icon: TournamentsIcon },
] as const

export default function V2Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <>
      {/* Content — padded at bottom so feed is never hidden behind the nav */}
      <div style={{ paddingBottom: 80 }}>
        {children}
      </div>

      {/* Fixed bottom nav — constrained to same 500px max-width as the app shell */}
      <nav style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500,
        background: 'var(--bg-base)', borderTop: '0.5px solid var(--border-base)',
        display: 'flex', zIndex: 20,
      }}>
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 4, padding: '12px 4px 14px', textDecoration: 'none',
                borderTop: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
              }}
            >
              <Icon active={active} />
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: active ? 'var(--color-accent)' : 'var(--text-faint)',
              }}>
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
