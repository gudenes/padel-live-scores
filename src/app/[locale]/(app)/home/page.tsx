'use client'
// Thin orchestrator — picks the desktop or mobile variant based on
// viewport. Both children mount independently (no shared state); the
// branch only flips when useIsDesktop() changes (e.g., user resizes
// across the 1100px threshold).

import { useIsDesktop } from '@/hooks/useIsDesktop'
import HomeMobile from './HomeMobile'
import HomeDesktop from './HomeDesktop'

export default function HomePage() {
  const isDesktop = useIsDesktop()
  return isDesktop ? <HomeDesktop /> : <HomeMobile />
}
