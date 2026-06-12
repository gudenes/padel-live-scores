// src/components/prediction/MatchPredictionVote.tsx
'use client'
import type { Match } from '@/types/match'
import { useMatchVote } from '@/hooks/useMatchVote'
import { ModelPredictionBar } from './ModelPredictionBar'
import { MatchVoteCard } from './MatchVoteCard'
import { PredictionComparison } from './PredictionComparison'

/** Model prediction + fan vote. Lifecycle:
 *  - scheduled: prominent prediction bar + open vote (then on-button % once voted)
 *  - live/finished: locked — a compact "Predictor vs Fans" comparison */
export function MatchPredictionVote({ match, pair1Label, pair2Label, locked: lockedProp }: {
  match: Match; pair1Label: string; pair2Label: string; locked?: boolean
}) {
  const locked = lockedProp ?? (match.status !== 'scheduled')
  const { yourPick, aggregate, vote } = useMatchVote(match.id, locked)

  // Once the match has started, show the compact Predictor-vs-Fans comparison
  // (names once, two animated bars) instead of the pre-match prediction bar +
  // vote buttons.
  if (locked) {
    return <PredictionComparison match={match} pair1Label={pair1Label} pair2Label={pair2Label} aggregate={aggregate} />
  }

  return (
    <>
      <ModelPredictionBar match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
      <MatchVoteCard
        pair1Label={pair1Label}
        pair2Label={pair2Label}
        yourPick={yourPick}
        aggregate={aggregate}
        locked={locked}
        onVote={vote}
      />
    </>
  )
}
