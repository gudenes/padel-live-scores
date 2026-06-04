// apps/ops/src/app/(app)/today/page.tsx
import './scoreboard.css'
import { Suspense } from 'react'
import { PageHeader } from '@/components/ui'
import { getScoreboardSnapshot } from './_lib/scoreboard-data'
import { ScoreboardView } from './_components/ScoreboardView'
import { TournamentOutlooks } from './_components/TournamentOutlooks'

export const metadata = { title: 'Today · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const today = new Date().toISOString().slice(0, 10)
  const snapshot = await getScoreboardSnapshot(today)
  return (
    <div className="ui-page sb-page">
      <PageHeader title="Today" />
      <ScoreboardView initial={snapshot} dateIso={today} />
      <Suspense fallback={<div className="sb-outlooks-loading">Loading tournament outlooks…</div>}>
        {/* async server component — streams in independently so the board paints immediately */}
        <TournamentOutlooks />
      </Suspense>
    </div>
  )
}
