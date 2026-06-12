// src/components/prediction/MatchPredictionVote.tsx
'use client'
import type { Match } from '@/types/match'
import { useMatchVote } from '@/hooks/useMatchVote'
import { getMatchPrediction } from '@/lib/match-prediction'
import { ModelPredictionBar } from './ModelPredictionBar'
import { MatchVoteCard } from './MatchVoteCard'

/** Combined model prediction bar + fan vote. Lifecycle:
 *  - scheduled: bar (if prediction) + open vote
 *  - live/finished: bar (frozen) + locked vote showing the community split */
export function MatchPredictionVote({ match, pair1Label, pair2Label, locked: lockedProp }: {
  match: Match; pair1Label: string; pair2Label: string; locked?: boolean
}) {
  const locked = lockedProp ?? (match.status !== 'scheduled')
  const { yourPick, aggregate, vote } = useMatchVote(match.id, locked)
  // When the prediction bar is stacked directly above the locked community
  // bar, both label the same two pairs — so the community bar drops the names
  // to avoid duplicating them.
  const hasPrediction = getMatchPrediction(match) != null
  return (
    <>
      <ModelPredictionBar match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
      <MatchVoteCard
        pair1Label={pair1Label}
        pair2Label={pair2Label}
        yourPick={yourPick}
        aggregate={aggregate}
        locked={locked}
        hideNames={locked && hasPrediction}
        onVote={vote}
      />
    </>
  )
}
