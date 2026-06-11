// src/components/prediction/MatchPredictionVote.tsx
'use client'
import type { Match } from '@/types/match'
import { useMatchVote } from '@/hooks/useMatchVote'
import { ModelPredictionBar } from './ModelPredictionBar'
import { MatchVoteCard } from './MatchVoteCard'

/** Combined model prediction bar + fan vote. Lifecycle:
 *  - scheduled: bar (if prediction) + open vote
 *  - live/finished: bar (frozen) + locked vote showing the community split */
export function MatchPredictionVote({ match, pair1Label, pair2Label }: {
  match: Match; pair1Label: string; pair2Label: string
}) {
  const locked = match.status !== 'scheduled'
  const { yourPick, aggregate, vote } = useMatchVote(match.id, locked)
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
