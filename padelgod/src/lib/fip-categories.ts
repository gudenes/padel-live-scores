// Maps padelfip.com WordPress `category-event` taxonomy term IDs to the
// `tournaments.level` codes the app's UI knows how to render.
//
// Source of truth for the IDs is the live taxonomy:
//   https://www.padelfip.com/wp-json/wp/v2/category-event?per_page=100
// (Pulled 2026-04-27 — IDs are stable, FIP doesn't renumber post types.)
//
// Premier Padel categories (23, 24, 25, 306, 387) are intentionally
// excluded. Padelapi.org owns Premier-tier match data and writes
// canonical level codes (`p1`, `p2`, `major`, `finals`). Letting padelgod
// stamp `fip_*` over a Premier row would corrupt the level. The
// `tournament.level` priority list in src/lib/source-priority.ts has
// padelapi above fip — this is the same rule, enforced at write time
// for the Railway pipeline (which doesn't go through filterUpdateByPriority).

export const FIP_CATEGORY_TO_LEVEL: Record<number, string> = {
  // CUPRA FIP Tour — parent 17
  18: 'fip_platinum',
  19: 'fip_gold',
  496: 'fip_silver',
  497: 'fip_bronze',
  20: 'fip_star',
  21: 'fip_rise',
  22: 'fip_promotion',
  28: 'fip_finals', // fip-tour-finals

  // Promises FIP Tour — parent 111 (umbrella) + 4 regional sub-cats + finals
  111: 'fip_promises',
  706: 'fip_promises', // asia
  707: 'fip_promises', // europe
  708: 'fip_promises', // africa
  709: 'fip_promises', // america
  714: 'fip_promises', // promises-finals-2025

  // FIP Beyond — parent 726 + B1/B2/B3 sub-cats
  726: 'fip_beyond',
  727: 'fip_beyond', // B1
  728: 'fip_beyond', // B2
  729: 'fip_beyond', // B3

  // Hexagon World Series
  730: 'fip_hexagon',

  // FIP Championships (umbrella + sub-cats)
  397: 'fip_championship',
  29: 'fip_championship', // world-championships
  30: 'fip_championship', // european-championships
  379: 'fip_championship', // junior-european
  380: 'fip_championship', // senior-european
  381: 'fip_championship', // junior-world
  382: 'fip_championship', // senior-world
  403: 'fip_championship', // fip-eur-championship
  482: 'fip_championship', // juniors-panamerican
  657: 'fip_championship', // asian-championships
  733: 'fip_championship', // fip-world-cup
  734: 'fip_championship', // fip-senior-world-cup
  735: 'fip_championship', // fip-junior-continental
  736: 'fip_championship', // olympic-path-events
  805: 'fip_championship', // fip-team-cup
}

// Slug-prefix fallback for the rare event whose `category-event` array is
// empty in the WP API response. This shouldn't happen in practice (FIP
// content workflow requires a category) but the parser already tolerates
// the empty case, so we tolerate it here too.
//
// Order matters — checked top to bottom, first match wins.
const SLUG_PREFIX_FALLBACKS: Array<[string, string]> = [
  ['fip-platinum-', 'fip_platinum'],
  ['fip-gold-', 'fip_gold'],
  ['fip-silver-', 'fip_silver'],
  ['fip-bronze-', 'fip_bronze'],
  ['fip-bronzr-', 'fip_bronze'], // typo in the FIP CMS — Sassuolo 2026
  ['fip-broze-', 'fip_bronze'],  // another typo — Indonesia 2026
  ['fip-star-', 'fip_star'],
  ['fip-rise-', 'fip_rise'],
  ['fip-promotion-', 'fip_promotion'],
  ['fip-promises-', 'fip_promises'],
  ['fip-beyond-', 'fip_beyond'],
  ['hexagon-', 'fip_hexagon'],
  ['fip-world-cup', 'fip_championship'],
  ['fip-senior-world-', 'fip_championship'],
  ['fip-junior-', 'fip_championship'],
  ['fip-juniors-', 'fip_championship'],
  ['fip-euro-', 'fip_championship'],
  ['fip-international-padel', 'fip_championship'],
  ['fip-team-cup', 'fip_championship'],
]

/**
 * Resolve a tournament's `level` code from its WP `category-event` term IDs
 * and slug. Returns null when no FIP-owned category matches — the caller
 * should leave the existing `level` value untouched in that case (covers
 * Premier Padel rows that padelapi has already stamped).
 */
export function resolveFipLevel(
  categoryTermIds: readonly number[],
  slug: string
): string | null {
  for (const id of categoryTermIds) {
    const level = FIP_CATEGORY_TO_LEVEL[id]
    if (level) return level
  }
  for (const [prefix, level] of SLUG_PREFIX_FALLBACKS) {
    if (slug.startsWith(prefix)) return level
  }
  return null
}

/**
 * Premier-tier WP category IDs and their level codes. Used by
 * tournament-discovery + fip-event-page-enricher as a gap-fill: when
 * an existing tournament row has level=null AND the WP event maps to
 * a Premier-tier category, write the level. Padelapi remains the
 * primary owner of Premier levels — this only fills nulls.
 */
const FIP_PREMIER_CATEGORY_TO_LEVEL: Record<number, string> = {
  18: 'fip_platinum',  // FIP-TOUR-PLATINUM
  24: 'major',          // FIP-PPT-MAJOR
  25: 'p1',             // FIP-PPT-P1
  306: 'finals',        // FIP-PP-MASTER-FINALS
  387: 'p2',            // FIP-PP-P2
};

export function resolvePremierLevel(
  categoryTermIds: readonly number[],
  _slug: string,
): string | null {
  for (const id of categoryTermIds) {
    const level = FIP_PREMIER_CATEGORY_TO_LEVEL[id];
    if (level) return level;
  }
  return null;
}
