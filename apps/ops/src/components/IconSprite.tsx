import type { ReactNode } from 'react'

// Inline <symbol> sprite — rendered once near the root.
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {/* ── From reference sprite ── */}
        <symbol id="i-search" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" />
        </symbol>

        <symbol id="i-today" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </symbol>

        <symbol id="i-odds" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h3l3-8 4 16 3-8h5" />
        </symbol>

        <symbol id="i-grid" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </symbol>

        <symbol id="i-list" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </symbol>

        <symbol id="i-flag" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <path d="M4 22v-7" />
        </symbol>

        <symbol id="i-play" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8l6 4-6 4z" fill="currentColor" stroke="none" />
        </symbol>

        <symbol id="i-users" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
          <path d="M16 6a3 3 0 010 6M21 20c0-2.5-1.5-4-3-4.5" />
        </symbol>

        <symbol id="i-tag" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v5l9 9 7-7-9-9H5a2 2 0 00-2 2z" />
          <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
        </symbol>

        <symbol id="i-video" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <path d="M16 10l6-3v10l-6-3z" />
        </symbol>

        <symbol id="i-yt" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="4" />
          <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
        </symbol>

        <symbol id="i-doc" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
          <path d="M14 3v6h6M8 13h8M8 17h6" />
        </symbol>

        <symbol id="i-film" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
        </symbol>

        <symbol id="i-heart" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11h3l2-4 3 8 2-5 1.5 3H21" />
        </symbol>

        <symbol id="i-check" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l2.5 2 3.5-.3.7 3.4 2.8 2.1-1.4 3.2 1.4 3.2-2.8 2.1-.7 3.4-3.5-.3L12 22l-2.5-2-3.5.3-.7-3.4L2.5 14.8 3.9 11.6 2.5 8.4 5.3 6.3 6 2.9 9.5 3.2z" />
          <path d="M9 12l2 2 4-4" />
        </symbol>

        <symbol id="i-server" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="7" rx="2" />
          <rect x="3" y="13" width="18" height="7" rx="2" />
          <path d="M7 7.5h.01M7 16.5h.01" />
        </symbol>

        <symbol id="i-eye" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </symbol>

        <symbol id="i-matrix" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        </symbol>

        <symbol id="i-toggle" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="10" rx="5" />
          <circle cx="8" cy="12" r="3" fill="currentColor" stroke="none" />
        </symbol>

        <symbol id="i-arch" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="12" cy="18" r="2.5" />
          <path d="M6 8.5v3a2 2 0 002 2h8a2 2 0 002-2v-3M12 13.5v2" />
        </symbol>

        <symbol id="i-bell" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
        </symbol>

        <symbol id="i-sun" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </symbol>

        <symbol id="i-moon" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </symbol>

        <symbol id="i-chev" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </symbol>

        <symbol id="i-pin" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 4h6l-1 7 3 3v2H7v-2l3-3z" />
          <path d="M12 16v4" />
        </symbol>

        <symbol id="i-share" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </symbol>

        {/* ── Added via Lucide (rotate-cw / refresh-cw) — not present in reference sprite ── */}
        <symbol id="i-retry" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 2v6h-6" />
          <path d="M21 13a9 9 0 11-3-7.7L21 8" />
        </symbol>
      </defs>
    </svg>
  )
}

export function Icon({ id, className }: { id: string; className?: string }): ReactNode {
  return (
    <svg className={className} aria-hidden>
      <use href={`#i-${id}`} />
    </svg>
  )
}
