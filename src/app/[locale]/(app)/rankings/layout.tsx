import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Player Rankings',
  description: 'Official FIP padel rankings and race standings. Track the top men\'s and women\'s padel players worldwide with live ranking updates.',
  openGraph: {
    title: 'Player Rankings | Padel Nachos',
    description: 'Official FIP padel rankings and race standings. Track the top padel players worldwide.',
  },
}

export default function RankingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
