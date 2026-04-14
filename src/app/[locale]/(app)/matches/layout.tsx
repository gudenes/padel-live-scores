import type { Metadata } from 'next'
import { buildAlternates } from '@/lib/seo-helpers'

export const metadata: Metadata = {
  title: 'Live Scores & Results',
  description: 'Live padel match scores updated in real time. Follow Premier Padel and FIP tournaments point by point with instant results.',
  openGraph: {
    title: 'Live Scores & Results | Padel Nachos',
    description: 'Live padel match scores updated in real time. Follow Premier Padel and FIP tournaments point by point.',
  },
  ...buildAlternates('/matches'),
}

export default function ScoresLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
