import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'News & Highlights',
  description: 'Padel news, match highlights, and video recaps from Premier Padel, FIP, and top padel channels. Stay up to date with the latest in professional padel.',
  openGraph: {
    title: 'News & Highlights | Padel Nachos',
    description: 'Padel news, match highlights, and video recaps. Stay up to date with the latest in professional padel.',
  },
}

export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
