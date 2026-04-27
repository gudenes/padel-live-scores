'use client'

// src/components/MatchesPageHeader.tsx
//
// Thin client wrapper that gives the server-rendered /matches/[date]
// page the same global header + search overlay it has on home / feed /
// following. The wrapper exists only because the daily page is a Server
// Component — both AppHeader and SearchOverlay need useState for the
// search-open toggle, and a server page can't host that state directly.

import { useState } from 'react'
import AppHeader from '@/components/AppHeader'
import SearchOverlay from '@/components/nav/SearchOverlay'

export default function MatchesPageHeader() {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <>
      <AppHeader onSearchOpen={() => setSearchOpen(true)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
