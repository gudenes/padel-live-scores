'use client'

import { ReactNode, CSSProperties } from 'react'

type Variant = 'default' | 'green' | 'orange'

export interface ChunkyPressButtonProps {
  onClick?: () => void
  variant?: Variant
  /**
   * When true, render the "filled" library variant from
   * public/mockup-buttons.html (#lib-saved et al): face is the variant
   * colour, text/icon are dark, and a real skirt element provides the
   * depth (vs. the default mode's dark face + coloured text + drop-shadow).
   * Default false to preserve existing call-sites.
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

export function ChunkyPressButton({
  onClick, variant = 'default', filled = false, className, style, ariaLabel, children,
}: ChunkyPressButtonProps) {
  // In `filled` mode the depth comes from a real skirt element (matches the
  // mockup-buttons.html reference). In default mode the depth comes from a
  // drop-shadow filter.
  const idleShadow = filled ? 'none' : 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
  const pressShadow = filled ? 'none' : 'drop-shadow(0 1px 1px rgba(0,0,0,0.55))'

  const faceBackground = filled ? VARIANT_COLOR[variant] : '#1C2029'
  const faceColor = filled ? '#0a0a0a' : VARIANT_COLOR[variant]
  const skirtBackground = VARIANT_SKIRT[variant]

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
        // In filled mode the skirt is positioned absolutely; the button is
        // `position: relative` so it anchors. Default mode keeps the existing
        // drop-shadow-only depth.
        position: 'relative',
        filter: idleShadow,
        transition: 'filter 100ms, transform 100ms ease-out',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
      onPointerDown={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(1px)'
        if (!filled) el.style.filter = pressShadow
      }}
      onPointerUp={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(0)'
        if (!filled) el.style.filter = idleShadow
      }}
      onPointerLeave={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(0)'
        if (!filled) el.style.filter = idleShadow
      }}
    >
      {/* Skirt — rendered behind the face when in filled mode. Offset down
          by 4px so the bottom edge peeks below the tilted face, matching
          the mockup. clip-path matches the face's silhouette so the skirt
          tracks the angular edges. */}
      {filled && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            top: 4,
            background: skirtBackground,
            clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
            zIndex: 0,
          }}
        />
      )}
      <span style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: faceBackground,
        clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
        color: faceColor,
      }}>
        {children}
      </span>
    </button>
  )
}
