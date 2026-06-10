// Pure layout math for the auto-height focus+context draw bracket.
// No React, no DOM — unit-testable.

export type Tier = 'full' | 'peek' | 'mini' | 'sliver'

/** Comfortable vertical pitch for one match in the SELECTED round. */
export const SLOT_PX = 58
/** Height of the per-column round label band above the first cell. */
export const LABEL_PX = 22
/** Gap between columns. */
export const GAP_PX = 6
/** Cap the rendered viewport height; taller (early) rounds scroll internally. */
export const MAX_VIEWPORT_PX = 430

/** Column width per tier. */
export const TIER_WIDTH: Record<Tier, number> = {
  full: 200,
  peek: 98,
  mini: 52,
  sliver: 30,
}

/** Distance from the selected round → tier.
 *  0 = focused round (full), +1 = next round (peek, right-edge),
 *  -1 = immediately-previous round (mini, scores only), else sliver. */
export function tierForDistance(d: number): Tier {
  if (d === 0) return 'full'
  if (d === 1) return 'peek'
  if (d === -1) return 'mini'
  return 'sliver'
}

/** Pyramid height, anchored to the selected round's match count. */
export function roundHeight(selectedMatchCount: number, slot: number = SLOT_PX): number {
  return selectedMatchCount * slot
}

/** Vertical center (px) of cell `i` (0-based, top→bottom) in a column of `n`
 *  cells drawn within a pyramid of height `height`. Same formula for every
 *  column, so the midpoint of feeders 2j/2j+1 equals destination center j. */
export function cellCenterY(i: number, n: number, height: number, label: number = LABEL_PX): number {
  return label + ((2 * i + 1) / (2 * n)) * height
}

export type ColumnGeom = { tier: Tier; width: number; left: number }

/** Width + cumulative left offset + tier for every column, given which
 *  round index is selected. */
export function computeColumns(roundCount: number, selectedIndex: number, gap: number = GAP_PX): ColumnGeom[] {
  const cols: ColumnGeom[] = []
  let x = 0
  for (let i = 0; i < roundCount; i++) {
    const tier = tierForDistance(i - selectedIndex)
    const width = TIER_WIDTH[tier]
    cols.push({ tier, width, left: x })
    x += width + gap
  }
  return cols
}

/** Total track width = right edge of the last column. */
export function trackWidth(cols: ColumnGeom[]): number {
  if (cols.length === 0) return 0
  const last = cols[cols.length - 1]
  return last.left + last.width
}

/** Horizontal pan so the focused column sits left-of-center with one
 *  compressed (mini-width) column peeking before it. Clamped to >= 0. */
export function panOffset(cols: ColumnGeom[], selectedIndex: number, gap: number = GAP_PX): number {
  const sel = cols[selectedIndex]
  if (!sel) return 0
  return Math.max(0, sel.left - TIER_WIDTH.mini - gap)
}

/** Cell box height per tier, clamped so compressed columns never overlap
 *  their vertical pitch (`spacing = height / n`). */
export function cellHeight(tier: Tier, spacing: number): number {
  const base =
    tier === 'full' ? 46
    : tier === 'peek' ? 46
    : tier === 'mini' ? Math.min(40, spacing - 3)
    : Math.min(14, spacing - 2)
  return Math.max(12, base)
}
