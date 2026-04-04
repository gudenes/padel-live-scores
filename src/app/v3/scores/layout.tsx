import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Live Scores & Results',
  description: 'Live padel match scores updated in real time. Follow Premier Padel and FIP tournaments point by point with instant results.',
  openGraph: {
    title: 'Live Scores & Results | Padel Nachos',
    description: 'Live padel match scores updated in real time. Follow Premier Padel and FIP tournaments point by point.',
  },
}

export default function ScoresLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
