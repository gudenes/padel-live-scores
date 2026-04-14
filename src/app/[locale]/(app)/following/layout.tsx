import type { Metadata } from 'next'
import { buildAlternates } from '@/lib/seo-helpers'

export const metadata: Metadata = {
  title: 'Following',
  description: 'Track your followed players, tournaments, and bookmarked matches all in one place.',
  openGraph: {
    title: 'Following | Padel Nachos',
    description: 'Track your followed players, tournaments, and bookmarked matches.',
  },
  ...buildAlternates('/following'),
}

export default function FollowingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
