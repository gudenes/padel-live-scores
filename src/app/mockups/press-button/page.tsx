'use client'

// src/app/mockups/press-button/page.tsx
//
// Side-by-side comparison of three tactile-press button variants.
// All share the same PressButton primitive and 70ms easing so the
// "feel" is identical — only the visual styling differs:
//
//   1. Chunky (current) — the asymmetric polygon already used across
//      the app's CTAs. Stock lime. Default depth.
//   2. Sentry-style    — rounded rectangle, slightly darker lime.
//      Reads as more "product-y" / web-app, less brand-specific.
//   3. Chunky tilted    — a parallelogram-leaning variation of #1.
//      Symmetric tilt on both vertical edges, deeper press for a
//      meatier squish.
//
// Click each button to feel the press. The skirt below each button
// is the "shadow" the face lands on when pressed.
//
// Not wired into any router — visit /mockups/press-button directly.

import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

// Presets are defined in PressButton.tsx so this mockup, the live
// SIGN IN button, and every future CTA share one source of truth.
// Adjusting a preset here = adjusting it everywhere.
const CHUNKY_ASYM = PRESS_PRESETS.chunkyAsymmetric
const ROUNDED = PRESS_PRESETS.rounded
const CHUNKY_TILTED = PRESS_PRESETS.chunkyTilted

const PAGE_BG = '#0A0A0A'
const CARD_BG = '#141414'
const BORDER = 'rgba(255,255,255,0.08)'
const MUTED = '#6B7280'

export default function PressButtonMockupPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: PAGE_BG,
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '24px 16px 96px',
    }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: -0.4,
          margin: '0 0 6px',
        }}>
          Press button — pick your feel
        </h1>
        <p style={{
          fontSize: 13,
          color: MUTED,
          lineHeight: 1.5,
          margin: '0 0 28px',
        }}>
          Click each button to feel the press. Same hook, same 70ms
          easing across all three — only the shape, color, and skirt
          depth differ.
        </p>

        <Card
          label="Option 1 — Chunky asymmetric"
          subtitle="Older brand silhouette · PRESS_PRESETS.chunkyAsymmetric"
        >
          <PressButton type="button" {...CHUNKY_ASYM} style={demoButtonStyle}>
            <SignInIcon />
            Iniciar sesión
          </PressButton>
          <Specs items={[
            ['accent', CHUNKY_ASYM.accent ?? ''],
            ['skirt', CHUNKY_ASYM.skirt ?? ''],
            ['depth', `${CHUNKY_ASYM.depth}px`],
            ['shape', 'polygon · asymmetric'],
          ]} />
        </Card>

        <Card
          label="Option 2 — Sentry-style rounded"
          subtitle="Rounded rectangle, darker lime · PRESS_PRESETS.rounded"
        >
          <PressButton type="button" {...ROUNDED} style={demoButtonStyle}>
            <SignInIcon />
            Iniciar sesión
          </PressButton>
          <Specs items={[
            ['accent', ROUNDED.accent ?? ''],
            ['skirt', ROUNDED.skirt ?? ''],
            ['depth', `${ROUNDED.depth}px`],
            ['shape', `rounded · ${ROUNDED.borderRadius}px radius`],
          ]} />
        </Card>

        <Card
          label="Option 3 — Chunky tilted (IN USE)"
          subtitle="App default · PRESS_PRESETS.chunkyTilted"
          highlighted
        >
          <PressButton type="button" {...CHUNKY_TILTED} style={demoButtonStyle}>
            <SignInIcon />
            Iniciar sesión
          </PressButton>
          <Specs items={[
            ['accent', CHUNKY_TILTED.accent ?? ''],
            ['skirt', CHUNKY_TILTED.skirt ?? ''],
            ['depth', `${CHUNKY_TILTED.depth}px`],
            ['shape', 'polygon · parallelogram'],
          ]} />
        </Card>

        <p style={{
          fontSize: 11,
          color: MUTED,
          textAlign: 'center',
          marginTop: 36,
          lineHeight: 1.6,
        }}>
          Press timing: 70ms ease-out — same for all variants.<br />
          Honors prefers-reduced-motion (snap, no transition).
        </p>
      </div>
    </div>
  )
}

// ── Layout primitives ─────────────────────────────────────────

function Card({
  label,
  subtitle,
  children,
  highlighted,
}: {
  label: string
  subtitle: string
  children: React.ReactNode
  /** Lime border + tinted bg for the option currently wired into the app. */
  highlighted?: boolean
}) {
  return (
    <div style={{
      background: highlighted ? 'rgba(126, 211, 33, 0.04)' : CARD_BG,
      border: `1px solid ${highlighted ? 'rgba(126, 211, 33, 0.4)' : BORDER}`,
      borderRadius: 12,
      padding: '18px 18px 14px',
      marginBottom: 16,
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: highlighted ? '#7ED321' : '#fff',
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 11,
        color: MUTED,
        marginBottom: 16,
      }}>
        {subtitle}
      </div>
      {children}
    </div>
  )
}

function Specs({ items }: { items: Array<[string, string]> }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      gap: '4px 12px',
      marginTop: 14,
      fontSize: 11,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      color: MUTED,
    }}>
      {items.map(([key, value]) => (
        <span key={key} style={{ display: 'contents' }}>
          <span style={{ textAlign: 'right' }}>{key}</span>
          <span style={{ color: '#D4D4D4' }}>{value}</span>
        </span>
      ))}
    </div>
  )
}

const demoButtonStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}

function SignInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
      <polyline points="10 17 15 12 10 7"/>
      <line x1="15" y1="12" x2="3" y2="12"/>
    </svg>
  )
}
