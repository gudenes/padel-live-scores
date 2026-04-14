import { Metadata } from 'next'
import { buildAlternates } from '@/lib/seo-helpers'

export const metadata: Metadata = {
  title: 'About Padel Nachos — Live Padel Scores Platform',
  description: 'Learn about Padel Nachos — the free platform for real-time padel scores, rankings, tournament draws, and highlights from Premier Padel and FIP.',
  openGraph: {
    title: 'About Padel Nachos',
    description: 'Learn about Padel Nachos — the free platform for real-time padel scores, rankings, and highlights.',
  },
  ...buildAlternates('/about'),
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
