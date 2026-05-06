import { applyCountryBoost } from './country-boost-sort'

export interface SuggestedPlayer {
  id: string
  name: string
  display_name?: string | null
  country: string | null
  ranking: number | null
  category?: string | null
  avatar_url?: string | null
}

export function boostAndTrim<T extends SuggestedPlayer>(
  players: readonly T[],
  boostCountry: string | null,
  limit: number,
): T[] {
  return applyCountryBoost(players, boostCountry, p => p.country).slice(0, limit)
}
