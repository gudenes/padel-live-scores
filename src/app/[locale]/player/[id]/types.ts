// Shared types for the player profile page and its tab sub-components.

export type PageTab = 'overview' | 'season' | 'partners' | 'matches' | 'stats' | 'earnings'

export interface MatchRow {
  id: string
  status: string
  round: string | null
  started_at: string | null
  finished_at: string | null
  scheduled_at: string | null
  winner_pair: number | null
  category: string | null
  duration: number | null
  tournament: { id: string; name: string | null; country: string | null; level: string | null; starts_at: string | null; ends_at: string | null } | null
  pair1_player1: PartnerInfo | null
  pair1_player2: PartnerInfo | null
  pair2_player1: PartnerInfo | null
  pair2_player2: PartnerInfo | null
  sets: Array<{ set_score: string | null; set_number: number }>
}

export interface PartnerInfo {
  id: string
  name: string
  display_name: string | null
  country: string | null
  avatar_url: string | null
}

export interface DerivedData {
  finished: MatchRow[]
  wins: number
  losses: number
  winRate: number | null
  last10Matches: MatchRow[]
  currentPartner: PartnerInfo | null
  cpWins: number
  cpLosses: number
  firstPartneredIso: string | null
  lastPartneredIso: string | null
  partnersList: Array<{ partner: PartnerInfo; wins: number; losses: number; lastIso: string | null }>
  availableYears: number[]
  nextScheduled: MatchRow | null
  nextTournament: { id: string; name: string | null; country: string | null; level: string | null; starts_at: string | null; ends_at: string | null } | null
}
