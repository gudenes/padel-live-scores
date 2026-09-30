'use client'

import GlobalHeader from '@/components/nav/GlobalHeader'

/** Legacy pages keep their search callback while sharing the same header. */
export default function AppHeader({ onSearchOpen }: { onSearchOpen?: () => void }) {
  return <GlobalHeader onSearchOpen={onSearchOpen} />
}
