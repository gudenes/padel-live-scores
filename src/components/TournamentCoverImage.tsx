'use client'

// Shared cover-image renderer used by every surface that displays a
// tournament's cover_image_url. Single internal strategy: cover crop
// biased to the top of the source image (FIP posters reliably place
// players + tier badge in the upper half).
//
// The `variant` prop currently doesn't change behavior — both render
// the same. It exists so consumers communicate intent and so future
// divergence (e.g. per-surface aspect-aware fallbacks) stays additive
// without churning every call site.
//
// Returns null when `src` is missing — consumers continue to render
// their existing tier-gradient fallback underneath this component.

import Image from 'next/image'

interface Props {
  src: string | null | undefined
  alt: string
  /**
   * Where this image is rendered. Future-proofing knob; currently a
   * documentation aid since both variants share the same treatment.
   * - `tile-portrait` → 178×240 carousel card
   * - `hero` → 360×260-ish hero card / large surface
   */
  variant: 'tile-portrait' | 'hero'
  /** Forwarded to next/image. Should match the rendered container width. */
  sizes: string
  /** Forwarded to next/image. Default false — only above-the-fold heroes opt in. */
  priority?: boolean
  /**
   * Which part of the source survives the crop.
   *
   * Defaults to `top`, which is right for FIP posters: they reliably place
   * players and the tier badge in the upper half.
   *
   * It is wrong for a photograph. The Pro Padel League ships portrait event
   * photos — a 496x820 New York skyline — and a top crop of that is sky with
   * the tip of one building. Their own site renders the same file centred and
   * the skyline reads perfectly, so the framing, not the image, was the
   * problem.
   */
  focal?: 'top' | 'center'
}

export default function TournamentCoverImage({
  src,
  alt,
  variant: _variant,
  sizes,
  priority = false,
  focal = 'top',
}: Props) {
  if (!src) return null
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      style={{ objectFit: 'cover', objectPosition: focal === 'center' ? 'center' : 'center top' }}
    />
  )
}
