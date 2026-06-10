// Pure layout math for the auto-height draw bracket.
// No React, no DOM — unit-testable.
//
// Model: only the SELECTED round (full) plus a thin peek of the NEXT round
// render. Earlier rounds are not shown. The panel height is anchored to the
// selected round's match count so later rounds tighten.

export type Tier = 'full' | 'peek' | 'mini' | 'sliver'

/** Comfortable vertical pitch (center-to-center) for one match in the
 *  SELECTED round. Larger = more space between matches. */
export const SLOT_PX = 84
/** Height of the per-column round label band above the first cell. */
export const LABEL_PX = 22
/** Gap between the focus column and the next-round peek. */
export const GAP_PX = 8
/** Visible width of the next-round peek sliver on the right edge. */
export const PEEK_PX = 52
/** Cap the rendered viewport height; taller (early) rounds scroll internally. */
export const MAX_VIEWPORT_PX = 460

/** Pyramid height, anchored to the selected round's match count. */
export function roundHeight(selectedMatchCount: number, slot: number = SLOT_PX): number {
  return selectedMatchCount * slot
}

/** Vertical center (px) of cell `i` (0-based, top→bottom) in a column of `n`
 *  cells drawn within a pyramid of height `height`. Same formula for every
 *  column, so the midpoint of feeders 2j/2j+1 equals destination center j —
 *  which keeps the focus→next connectors aligned. */
export function cellCenterY(i: number, n: number, height: number, label: number = LABEL_PX): number {
  return label + ((2 * i + 1) / (2 * n)) * height
}

/** Cell box height per tier, clamped so a compressed column never overlaps
 *  its vertical pitch (`spacing = height / n`). */
export function cellHeight(tier: Tier, spacing: number): number {
  const base =
    tier === 'full' ? 46
    : tier === 'peek' ? 46
    : tier === 'mini' ? Math.min(40, spacing - 3)
    : Math.min(14, spacing - 2)
  return Math.max(12, base)
}
