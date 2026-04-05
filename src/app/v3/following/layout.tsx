import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Following',
  description: 'Track your followed players, tournaments, and bookmarked matches all in one place.',
  openGraph: {
    title: 'Following | Padel Nachos',
    description: 'Track your followed players, tournaments, and bookmarked matches.',
  },
}

export default function FollowingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
