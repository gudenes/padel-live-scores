'use client'

// src/components/PressButton.tsx
//
// Tactile 3D button primitive — the "press into its own shadow" feel
// inspired by Sentry's CTAs, but compatible with our chunky polygon
// clip-paths.
//
// Why two stacked spans instead of `box-shadow` for the skirt:
//   A box-shadow would be clipped along with the button if the button
//   has a clipPath. Rendering the skirt as a separately-clipped sibling
//   underneath the face lets both layers share the same chunky polygon
//   silhouette and still cast a visible 3D depth.
//
// Structure:
//   <button>                ← transparent wrapper, owns layout/sizing
//     <span pn-skirt />     ← back layer, accent-darker, offset down
//     <span pn-face>...     ← front layer, accent color, content+padding
//   </button>
//
// On :active the face translates down by `depth`, landing on top of the
// skirt — the user sees the button "press in". The CSS rule lives in
// globals.css (`.pn-press`) and uses CSS custom properties so per-
// instance accent / depth / clipPath all work without restyling.
//
// All styling stays pure CSS — no JS on pointer events, so there's no
// touch latency.

import { createElement } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, ElementType, ReactNode } from 'react'

const DEFAULT_ACCENT = '#7ED321'   // PadelNachos lime
const DEFAULT_SKIRT = '#5FA516'    // Lime, ~18% darker
const DEFAULT_TEXT = '#0a0a0a'     // Dark text on lime
const DEFAULT_DEPTH = 4            // px

/**
 * Stock chunky polygon (asymmetric corners). Kept as a named export
 * for callers who want just the clip-path without the rest of a
 * preset. Most code should use PRESS_PRESETS below instead.
 */
export const PRESS_CHUNKY_CLIP =
  'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

/**
 * Bundle of {clipPath | borderRadius, accent, skirt, depth} that can
 * be spread onto a PressButton. Lets every CTA in the app stay
 * visually consistent without each call site re-stating the same
 * colors and shape. Spread example:
 *
 *   <PressButton {...PRESS_PRESETS.chunkyTilted} onClick={...}>
 *     Sign in
 *   </PressButton>
 *
 * Add a new preset here when you need a new accent (e.g. orange for
 * destructive, neutral for secondary) — keep the depth + easing
 * consistent so the "satisfying" feel transfers across the app.
 */
export interface PressPreset {
  clipPath?: string
  borderRadius?: number
  accent?: string
  skirt?: string
  depth?: number
  textColor?: string
}

export const PRESS_PRESETS = {
  /**
   * Default for primary CTAs across the app. Symmetric parallelogram
   * tilt on the vertical edges with a 5px skirt — the user-picked
   * option 3 from the press-button mockup (see
   * /mockups/press-button). Same lime as the rest of the brand.
   *
   * Tilt softened from 8% → 4% to avoid the asymmetric skirt-overhang
   * artifact that became visible on smaller / narrower buttons where
   * the angled edges read as misalignment instead of 3D depth.
   */
  chunkyTilted: {
    clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
    accent: '#7ED321',
    skirt: '#558D14',
    depth: 5,
  } satisfies PressPreset,

  /**
   * Older brand silhouette — asymmetric polygon with cuts at the top
   * corners. Kept available for places where the existing card / chip
   * art already uses this shape and consistency matters more than the
   * tilt feel.
   */
  chunkyAsymmetric: {
    clipPath: PRESS_CHUNKY_CLIP,
    accent: '#7ED321',
    skirt: '#5FA516',
    depth: 4,
  } satisfies PressPreset,

  /**
   * Plain rounded rectangle — reads as more "product-y" / web-app
   * than the chunky polygons. Useful for embedded surfaces where the
   * brand silhouette would feel out of place (e.g. inside a
   * third-party-style modal).
   */
  rounded: {
    borderRadius: 8,
    accent: '#6BB81C',
    skirt: '#4F8B14',
    depth: 4,
  } satisfies PressPreset,

  /**
   * Inline-button variant — same chunky parallelogram silhouette
   * and brand lime as `chunkyTilted`, just with a shorter skirt
   * depth proportional to smaller button heights. Use for inline
   * CTAs (modal submits, card-level "Send message" buttons, inline
   * chips) where a 5px skirt would look chunky-disproportionate
   * relative to a 30px button height.
   */
  chunkyInline: {
    clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
    accent: '#7ED321',
    skirt: '#558D14',
    depth: 3,
  } satisfies PressPreset,
} as const

export interface PressButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  /** Top face color. Default: PadelNachos lime. */
  accent?: string
  /** Skirt color (darker shade of accent). Default: darker lime. */
  skirt?: string
  /** Skirt thickness in px. Default 4. Larger = chunkier press feel. */
  depth?: number
  /** Foreground color. Default: near-black for lime accent. */
  textColor?: string
  /**
   * Clip-path applied to BOTH face and skirt — they share the same
   * silhouette so the press effect reads correctly with chunky
   * polygons. Pass `PRESS_CHUNKY_CLIP` for the app's stock CTA shape,
   * a custom polygon string, or omit for a plain rectangle (use
   * `borderRadius` in style instead for rounded corners).
   */
  clipPath?: string
  /** Border radius (px). Alternative to `clipPath` for rounded buttons. */
  borderRadius?: number
  /**
   * Element to render as. Default `'button'`. Use `'div'` or `'span'`
   * when the press effect lives INSIDE another interactive element
   * (e.g. a parent `<Link>` / `<a>` / `<button>`) where a nested
   * button would invalidate HTML. The :active CSS rule fires on any
   * element type, so the press feel is identical.
   *
   * The wrapping element still gets all the rest props, so e.g.
   * `as="a" href="..."` works for link-shaped CTAs.
   */
  as?: ElementType
  /**
   * Layout style for the outer wrapper (width, height, font, etc.).
   * Visual styling (background, color, clipPath) is handled by the
   * face/skirt layers and shouldn't be set here.
   */
  style?: CSSProperties
  children?: ReactNode
}

// Style properties that affect the face's INNER content rather than
// the wrapper's outer footprint. These get extracted from the user's
// `style` prop and applied to the face span — keeping them on the
// wrapper would push the wrapper bigger than the face, causing the
// absolutely-positioned skirt (inset: 0 → wrapper's padding box) to
// render wider than the face on each side. Moving padding to the
// face keeps wrapper, face, and skirt all the same outer dimensions.
const FACE_PROPS = [
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingInline',
  'paddingBlock',
  'paddingInlineStart',
  'paddingInlineEnd',
  'paddingBlockStart',
  'paddingBlockEnd',
  'textAlign',
  'gap',
  'rowGap',
  'columnGap',
] as const

function splitStyle(style: CSSProperties | undefined): {
  wrapperStyle: CSSProperties
  faceStyleFromUser: CSSProperties
} {
  if (!style) return { wrapperStyle: {}, faceStyleFromUser: {} }
  const wrapperStyle: Record<string, unknown> = {}
  const faceStyleFromUser: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(style)) {
    if ((FACE_PROPS as readonly string[]).includes(key)) {
      faceStyleFromUser[key] = value
    } else {
      wrapperStyle[key] = value
    }
  }
  return {
    wrapperStyle: wrapperStyle as CSSProperties,
    faceStyleFromUser: faceStyleFromUser as CSSProperties,
  }
}

export default function PressButton({
  accent = DEFAULT_ACCENT,
  skirt = DEFAULT_SKIRT,
  depth = DEFAULT_DEPTH,
  textColor = DEFAULT_TEXT,
  clipPath,
  borderRadius,
  as = 'button',
  style,
  className,
  children,
  ...rest
}: PressButtonProps) {
  const mergedClass = className ? `pn-press ${className}` : 'pn-press'
  const isButton = as === 'button'

  // Per-instance CSS variables — picked up by the .pn-press / .pn-press-face
  // rules in globals.css for the :active transform.
  const cssVars = {
    '--pn-press-depth': `${depth}px`,
  } as CSSProperties

  // Both face and skirt share the silhouette. If neither clipPath nor
  // borderRadius is provided, the layers stay rectangular.
  const shapeStyle: CSSProperties = {
    ...(clipPath ? { clipPath } : {}),
    ...(borderRadius != null ? { borderRadius } : {}),
  }

  // Split the user's style: padding/gap/textAlign → face, everything
  // else → wrapper. See FACE_PROPS for the rationale.
  const { wrapperStyle, faceStyleFromUser } = splitStyle(style)

  // When rendering as a non-button (div / span / a inside a parent
  // interactive), drop button-only attributes the user shouldn't be
  // passing anyway but might accidentally spread via preset objects.
  const wrapperProps: Record<string, unknown> = { ...rest }
  if (!isButton) {
    delete wrapperProps.disabled
    delete wrapperProps.type
  }

  return createElement(
    as,
    {
      className: mergedClass,
      style: {
        position: 'relative',
        background: 'transparent',
        border: 0,
        padding: 0,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        color: textColor,
        // Reserve room for the skirt so the layout doesn't shift when
        // the face presses down onto it.
        marginBottom: depth,
        // Reset default user-agent styling on non-button wrappers so
        // they don't pick up underline / text-decoration if rendered
        // as an <a>.
        ...(isButton ? {} : { textDecoration: 'none', display: 'block' }),
        ...cssVars,
        ...wrapperStyle,
      },
      ...wrapperProps,
    },
    <>
      {/* Skirt — back layer, offset down by `depth`, darker color.
          aria-hidden because it's purely decorative. */}
      <span
        aria-hidden
        className="pn-press-skirt"
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateY(${depth}px)`,
          background: skirt,
          ...shapeStyle,
        }}
      />
      {/* Face — front layer, holds the content. The :active rule in
          globals.css translates this down by depth, landing on the
          skirt and giving the press-in feel. Padding from the user's
          style is applied here (not on the wrapper) so the face
          fills exactly the same footprint as the skirt. */}
      <span
        className="pn-press-face"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: accent,
          color: textColor,
          // Subtle top-edge sheen — same gradient Sentry uses.
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.22)',
          // Box-sizing border-box so width:100% + padding doesn't push
          // the face wider than the wrapper.
          boxSizing: 'border-box',
          ...shapeStyle,
          ...faceStyleFromUser,
        }}
      >
        {children}
      </span>
    </>,
  )
}
