'use client'

import { ReactNode, CSSProperties, useState } from 'react'

type Variant = 'default' | 'green' | 'orange'

export interface ChunkyPressButtonProps {
  onClick?: () => void
  variant?: Variant
  /**
   * When true, render the "filled" library variant from
   * public/mockup-buttons.html (#lib-saved et al): face is the variant
   * colour, text/icon are dark/contrasting, and a real skirt element sits
   * permanently below the face. On press, the face translates DOWN onto
   * the skirt — that's where the tactile "stamped paper / pressed key"
   * feel comes from. Default false to preserve existing call-sites.
   */
  filled?: boolean
  className?: string
  style?: CSSProperties
  ariaLabel?: string
  children: ReactNode
}

const VARIANT_COLOR: Record<Variant, string> = {
  default: 'rgba(255,255,255,0.94)',
  green:   '#7ED321',
  orange:  '#F5A623',
}

// Darker shades used as the skirt under each face in `filled` mode. These
// match the mockup's `.intent-* .pn-press-skirt` palette so the visual is
// 1:1 with #lib-saved / #lib-notify / etc.
const VARIANT_SKIRT: Record<Variant, string> = {
  default: '#0a0a0a',
  green:   '#558D14',
  orange:  '#A66E16',
}

// Press depth in pixels — matches the mockup's `size-md` (--pn-press-depth: 5px).
// The wrapper reserves `marginBottom: PRESS_DEPTH` so the skirt overhang
// doesn't collide with siblings, and on press the face translates DOWN by
// this exact amount onto the skirt.
const PRESS_DEPTH = 5

// Shared clip-path for both face and skirt — chunky-tilted silhouette so the
// skirt edge follows the same angular footprint as the face.
const CHUNKY_TILTED_CLIP = 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)'

export function ChunkyPressButton({
  onClick, variant = 'default', filled = false, className, style, ariaLabel, children,
}: ChunkyPressButtonProps) {
  // React state for the press transform in filled mode. Default mode
  // continues to mutate styles imperatively (no behaviour change there).
  const [pressed, setPressed] = useState(false)

  // Default mode keeps its drop-shadow depth and 1px nudge — unchanged.
  if (!filled) {
    const faceBackground = '#1C2029'
    const faceColor = VARIANT_COLOR[variant]
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={className}
        style={{
          display: 'inline-block',
          padding: 0,
          border: 0,
          background: 'transparent',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
          transition: 'filter 100ms, transform 100ms ease-out',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
          ...style,
        }}
        onPointerDown={e => {
          const el = e.currentTarget
          el.style.transform = 'translateY(1px)'
          el.style.filter = 'drop-shadow(0 1px 1px rgba(0,0,0,0.55))'
        }}
        onPointerUp={e => {
          const el = e.currentTarget
          el.style.transform = 'translateY(0)'
          el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
        }}
        onPointerLeave={e => {
          const el = e.currentTarget
          el.style.transform = 'translateY(0)'
          el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
        }}
      >
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: faceBackground,
          clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
          color: faceColor,
        }}>
          {children}
        </span>
      </button>
    )
  }

  // Filled mode — direct port of `.pn-press.shape-chunky-tilted.intent-*`
  // from public/mockup-buttons.html. The wrapper is purely structural; the
  // skirt is an absolute layer behind the face, translated DOWN by the
  // press-depth so the bottom edge peeks below. The face translates DOWN
  // by the same amount on press so it stamps onto the skirt.
  const faceBackground = VARIANT_COLOR[variant]
  const skirtBackground = VARIANT_SKIRT[variant]
  // Text colour: green/orange face → black; default (white) face → still black.
  const faceColor = '#0a0a0a'

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-block',
        padding: 0,
        border: 0,
        background: 'transparent',
        // Reserve the skirt's vertical footprint so siblings don't collide
        // with the overhang. Matches the mockup's `.pn-press { margin-bottom }`.
        marginBottom: PRESS_DEPTH,
        cursor: 'pointer',
        color: faceColor,
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
    >
      {/* Skirt — sits permanently translated DOWN by the depth, so its
          bottom edge peeks below the face. clip-path matches the face. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${PRESS_DEPTH}px)`,
          background: skirtBackground,
          clipPath: CHUNKY_TILTED_CLIP,
        }}
      />

      {/* Face — sits at translateY(0) at rest, slides DOWN by depth on
          press so it stamps onto the skirt. 70 ms transition for snappy
          feel without feeling instantaneous. Inset top highlight adds the
          subtle plastic-key sheen the mockup has. */}
      <span style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: faceBackground,
        color: faceColor,
        clipPath: CHUNKY_TILTED_CLIP,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.22)',
        transform: `translateY(${pressed ? PRESS_DEPTH : 0}px)`,
        transition: 'transform 70ms ease-out',
        // Bold uppercase typography mirrors the mockup's `.pn-press-face`.
        // Callers can still override via their inner <span> if they want
        // mixed-case text — but the default matches #lib-saved 1:1.
        fontWeight: 900,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        userSelect: 'none',
      }}>
        {children}
      </span>
    </button>
  )
}
