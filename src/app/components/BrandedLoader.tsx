'use client'
// src/app/components/BrandedLoader.tsx
// Branded loading state with pulsing logo and rotating hint text.
// Used in place of the basic Spinner across the app for a more polished feel.
// Each variant can pass its own hints array so the messaging matches the page.

import { useEffect, useState } from 'react'
import { BG_BASE, GREEN, MUTED } from '@/lib/theme-colors'

interface BrandedLoaderProps {
  /** Hints rotated below the logo. Defaults to a generic set if omitted. */
  hints?: string[]
  /** Pixel height of the logo (default 56) */
  logoSize?: number
  /** Fills the viewport vertically (default true) */
  fullHeight?: boolean
  /** Background — defaults to the app dark base */
  background?: string
  /** Show the green progress dots row (default true) */
  showDots?: boolean
  /** Hint rotation interval in ms (default 2000) */
  rotateMs?: number
}

const DEFAULT_HINTS = [
  'Warming up the court...',
  'Loading live scores...',
  'Almost there...',
  'Setting up your view...',
]

export default function BrandedLoader({
  hints = DEFAULT_HINTS,
  logoSize = 56,
  fullHeight = true,
  background = BG_BASE as string,
  showDots = true,
  rotateMs = 2000,
}: BrandedLoaderProps) {
  const [hintIdx, setHintIdx] = useState(0)

  useEffect(() => {
    if (hints.length <= 1) return
    const interval = setInterval(() => {
      setHintIdx(i => (i + 1) % hints.length)
    }, rotateMs)
    return () => clearInterval(interval)
  }, [hints.length, rotateMs])

  return (
    <div
      data-branded-loader
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 18,
        minHeight: fullHeight ? '60dvh' : undefined,
        padding: '40px 20px',
        background,
      }}
    >
      {/* Animated logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/padelnachos-logo-v2.png"
        alt="PadelNachos"
        style={{
          height: logoSize,
          objectFit: 'contain',
          animation: 'brandedLoaderPulse 1.8s ease-in-out infinite',
        }}
      />

      {/* Rotating hint text */}
      <div style={{
        height: 22, minWidth: 220,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <span
          key={hintIdx}
          style={{
            color: MUTED,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.3,
            animation: 'brandedLoaderFade 2s ease-in-out',
            display: 'inline-block',
            textAlign: 'center',
          }}
        >
          {hints[hintIdx]}
        </span>
      </div>

      {/* Progress dots */}
      {showDots && (
        <div style={{ display: 'flex', gap: 7 }}>
          {[0, 1, 2].map(i => (
            <span
              key={i}
              style={{
                width: 7, height: 7, borderRadius: '50%',
                background: GREEN,
                animation: `brandedLoaderDot 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes brandedLoaderPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
        @keyframes brandedLoaderFade {
          0% { opacity: 0; transform: translateY(6px); }
          15% { opacity: 1; transform: translateY(0); }
          85% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-6px); }
        }
        @keyframes brandedLoaderDot {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.4); }
        }
      `}</style>
    </div>
  )
}

// ── Pre-canned hint sets for common pages ──────────────────────
export const LOADER_HINTS = {
  home: [
    'Loading live matches...',
    'Fetching latest results...',
    'Updating rankings...',
    'Almost ready...',
  ],
  matches: [
    'Loading matches...',
    'Checking who is on court...',
    'Pulling latest scores...',
    'Almost there...',
  ],
  tournament: [
    'Loading tournament...',
    'Fetching matches...',
    'Building the bracket...',
    'Almost there...',
  ],
  match: [
    'Loading match...',
    'Pulling scores...',
    'Fetching player stats...',
    'Almost ready...',
  ],
  player: [
    'Loading player...',
    'Fetching career stats...',
    'Pulling recent matches...',
    'Almost ready...',
  ],
  feed: [
    'Loading feed...',
    'Fetching latest news...',
    'Curating videos...',
    'Almost there...',
  ],
  following: [
    'Loading favorites...',
    'Syncing your follows...',
    'Almost there...',
  ],
} as const
