// src/components/match-card-fav-tag.ts
// Pure gating helper for the match-card model-favorite tag. Lives in its own
// module (no 'use client', no posthog/next-intl imports) so it can be unit
// tested under the repo's default `node` vitest environment without crashing
// at module load. Re-exported from MatchCard.tsx to preserve the public API.
import type { Match } from '@/types/match'
import { getMatchPrediction } from '@/lib/match-prediction'

/** True when the model favorite tag should render on this pair's row. */
export function shouldShowFavTag(match: Match, pairNum: 1 | 2, enabled: boolean): boolean {
  if (!enabled) return false
  const pred = getMatchPrediction(match)
  return pred != null && pred.favored === pairNum
}
