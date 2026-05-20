// Tier-aware gradient + pill colors for tournament-level visual treatment.
//
// Surfaces that paint tier color:
//   - Home Live Tournaments carousel (cards + level pills)
//   - Tournament detail page level pill
//
// Surfaces that intentionally stay neutral (do NOT use these maps):
//   - /matches tournament rows
//   - TournamentSpotlightHero
//
// Keys match production `tournaments.level` values (Premier tiers are bare,
// FIP tiers carry the `fip_` prefix). All 17 known levels are mapped here;
// unknown values fall back to FALLBACK_GRADIENT / FALLBACK_PILL.

const PREMIER_GRADIENT = 'linear-gradient(135deg, #6B46C1, #9333EA)'
const GOLD_GRADIENT    = 'linear-gradient(135deg, #92750E, #EAB308)'
const SILVER_GRADIENT  = 'linear-gradient(135deg, #475569, #94A3B8)'
const BRONZE_GRADIENT  = 'linear-gradient(135deg, #92400E, #D97706)'
const CYAN_GRADIENT    = 'linear-gradient(135deg, #155E75, #06B6D4)'
const SLATE_GRADIENT   = 'linear-gradient(135deg, #334155, #64748B)'

export const FALLBACK_GRADIENT = 'linear-gradient(135deg, #2A2A2A, #1A1A1A)'
export const FALLBACK_PILL: TierPillStyle = { background: '#444', color: '#fff' }

export interface TierPillStyle {
  background: string
  color: string
}

export const TIER_GRADIENT: Record<string, string> = {
  finals: PREMIER_GRADIENT,
  major:  PREMIER_GRADIENT,
  p1:     PREMIER_GRADIENT,
  p2:     PREMIER_GRADIENT,
  fip_platinum:     GOLD_GRADIENT,
  fip_gold:         GOLD_GRADIENT,
  fip_hexagon:      PREMIER_GRADIENT,
  fip_championship: PREMIER_GRADIENT,
  fip_finals:       GOLD_GRADIENT,
  fip_silver:       SILVER_GRADIENT,
  fip_bronze:       BRONZE_GRADIENT,
  fip_star:         CYAN_GRADIENT,
  fip_rise:         CYAN_GRADIENT,
  fip_promotion:    CYAN_GRADIENT,
  fip_promises:     SLATE_GRADIENT,
  fip_beyond:       SLATE_GRADIENT,
  fip_other:        SLATE_GRADIENT,
}

export const TIER_PILL: Record<string, TierPillStyle> = {
  finals:           { background: PREMIER_GRADIENT, color: '#fff' },
  major:            { background: PREMIER_GRADIENT, color: '#fff' },
  p1:               { background: PREMIER_GRADIENT, color: '#fff' },
  p2:               { background: PREMIER_GRADIENT, color: '#fff' },
  fip_platinum:     { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_gold:         { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_hexagon:      { background: PREMIER_GRADIENT, color: '#fff' },
  fip_championship: { background: PREMIER_GRADIENT, color: '#fff' },
  fip_finals:       { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_silver:       { background: SILVER_GRADIENT,  color: '#fff' },
  fip_bronze:       { background: BRONZE_GRADIENT,  color: '#fff' },
  fip_star:         { background: CYAN_GRADIENT,    color: '#fff' },
  fip_rise:         { background: CYAN_GRADIENT,    color: '#fff' },
  fip_promotion:    { background: CYAN_GRADIENT,    color: '#fff' },
  fip_promises:     { background: SLATE_GRADIENT,   color: '#fff' },
  fip_beyond:       { background: SLATE_GRADIENT,   color: '#fff' },
  fip_other:        { background: SLATE_GRADIENT,   color: '#fff' },
}

/** Convenience getters that always return a value (defaults applied). */
export function getTierGradient(level: string | null | undefined): string {
  if (!level) return FALLBACK_GRADIENT
  return TIER_GRADIENT[level] ?? FALLBACK_GRADIENT
}

export function getTierPill(level: string | null | undefined): TierPillStyle {
  if (!level) return FALLBACK_PILL
  return TIER_PILL[level] ?? FALLBACK_PILL
}
