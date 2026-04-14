// src/app/[locale]/(app)/home/layout.tsx
// Static metadata for the home page — no DB query needed.

import { Metadata } from 'next'
import { buildAlternates } from '@/lib/seo-helpers'

export const metadata: Metadata = {
  title: 'Live Padel Scores & Results',
  description:
    'Follow every point live. Real-time scores, player rankings, tournament draws, highlights, and breaking news from Premier Padel and FIP — all in one app.',
  ...buildAlternates('/home'),
}

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
