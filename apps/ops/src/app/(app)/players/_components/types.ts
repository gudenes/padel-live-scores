// src/app/ops/players/types.ts

export interface PlayerSummary {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  points: number | null
  category: string | null
  avatar_url: string | null
  fip_id: string | null
  equipment: { brand: string; model: string; year: number | null } | null
}

export interface PlayerDetail {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  ranking: number | null
  points: number | null
  ranking_move: number | null
  race_ranking: number | null
  race_points: number | null
  race_move: number | null
  external_id: string | null
  fip_id: string | null
  avatar_url: string | null
  profile_url: string | null
  side: string | null
  height: string | null
  birthdate: string | null
  birthplace: string | null
  hand: string | null
  titles: number | null
  finals: number | null
  semifinals: number | null
  win_rate: number | null
  total_matches: number | null
  equipment: {
    racket_brand?: string
    racket_model?: string
    racket_url?: string
    racket_image?: string
    brand_logo?: string
  } | null
  created_at: string | null
  updated_at: string | null
}

export type DataFilter = 'all' | 'missing_equipment' | 'missing_avatar' | 'missing_ranking'
export type CategoryFilter = 'all' | 'men' | 'women'

export interface FilterCounts {
  total: number
  missing_equipment: number
  missing_avatar: number
  missing_ranking: number
}

/** 4 booleans: [hasAvatar, hasRanking, hasFipId, hasEquipment] */
export function computeCompleteness(p: PlayerSummary): boolean[] {
  return [
    !!p.avatar_url,
    p.ranking != null,
    !!p.fip_id,
    !!p.equipment,
  ]
}
