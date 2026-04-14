import type { Metadata } from 'next'
import { buildAlternates } from '@/lib/seo-helpers'

export const metadata: Metadata = {
  title: 'News & Highlights',
  description: 'Padel news, match highlights, and video recaps from Premier Padel, FIP, and top padel channels. Stay up to date with the latest in professional padel.',
  openGraph: {
    title: 'News & Highlights | Padel Nachos',
    description: 'Padel news, match highlights, and video recaps. Stay up to date with the latest in professional padel.',
  },
  ...buildAlternates('/feed'),
}

export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
