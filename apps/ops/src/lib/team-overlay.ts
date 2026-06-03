// apps/ops/src/lib/team-overlay.ts
// Deterministic compositor: overlap two transparent player cut-out PNGs into a
// single transparent PNG. No background, no text. Used by the team-image route.
import sharp from 'sharp'

export interface TeamOverlayOptions {
  /** Fraction of the FRONT figure's width that overlaps the back figure. */
  overlapFraction?: number
}

const DEFAULT_OVERLAP = 0.28

/**
 * Composite two transparent cut-out portraits, overlapping, onto a transparent
 * canvas cropped tight to the figures. `bufB` (the second player) is placed in
 * FRONT. Both inputs are trimmed of transparent margins and normalized to the
 * SMALLER of the two trimmed heights (downscale-only → no quality loss).
 * Returns a PNG buffer with alpha preserved.
 */
export async function composeTeamOverlay(
  bufA: Buffer,
  bufB: Buffer,
  options: TeamOverlayOptions = {},
): Promise<Buffer> {
  const overlapFraction = options.overlapFraction ?? DEFAULT_OVERLAP

  // 1. Trim transparent margins to tight figure bounds.
  const trimmedA = await sharp(bufA).trim().png().toBuffer()
  const trimmedB = await sharp(bufB).trim().png().toBuffer()
  const metaA = await sharp(trimmedA).metadata()
  const metaB = await sharp(trimmedB).metadata()

  // 2. Normalize both to equal height = smaller trimmed height (downscale-only).
  const targetH = Math.min(metaA.height ?? 0, metaB.height ?? 0)
  if (!targetH) throw new Error('team-overlay: a source image has zero height after trim')
  const figA = await sharp(trimmedA).resize({ height: targetH }).png().toBuffer()
  const figB = await sharp(trimmedB).resize({ height: targetH }).png().toBuffer()
  const wA = (await sharp(figA).metadata()).width ?? 0
  const wB = (await sharp(figB).metadata()).width ?? 0

  // 3. Overlap by a fraction of the front figure's width.
  const overlapPx = Math.round(wB * overlapFraction)
  const canvasW = wA + wB - overlapPx

  // 4. Composite onto a transparent canvas; figB (second player) painted last → in front.
  return sharp({
    create: { width: canvasW, height: targetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: figA, left: 0, top: 0 },
      { input: figB, left: wA - overlapPx, top: 0 },
    ])
    .png()
    .toBuffer()
}
