// src/components/skeletons/MatchCardSkeleton.tsx
//
// Structured shimmer placeholder for one MatchCard. Mirrors the real
// card's layout (left accent strip, chips row, two pair rows with
// flag stack + name) so when the matches feed loads the swap-in is
// invisible — no layout shift.
//
// Used by the tournament-detail page's matches feed during its
// internal client-side loading state. Previously that spot rendered
// dim static rectangles (`opacity: 0.3`); the shimmer animation +
// matching structure are a much nicer perceived-load.
//
// Uses the global `.skeleton-line` class from src/app/globals.css —
// LinkedIn-style sliding-gradient shimmer, already battle-tested in
// the profile page.

const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export default function MatchCardSkeleton() {
  return (
    <div
      style={{
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        clipPath: CHUNKY_CARD,
        padding: '12px 14px 12px 16px',
        marginBottom: 8,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left accent bar — match real MatchCard's gender-color stripe.
          Plain muted color here since we don't know category yet. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 3,
          background: 'rgba(255,255,255,0.10)',
        }}
      />

      {/* Chips row — round + court (+ optional status badge). */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <span
          className="skeleton-line"
          style={{ width: 36, height: 14, display: 'inline-block' }}
          aria-hidden
        >
          .
        </span>
        <span
          className="skeleton-line"
          style={{ width: 88, height: 14, display: 'inline-block' }}
          aria-hidden
        >
          .
        </span>
      </div>

      {/* Pair 1 row — flag stack placeholder + name placeholder. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 0',
        }}
      >
        <div
          style={{
            width: 26,
            height: 20,
            background: 'rgba(255,255,255,0.05)',
            flexShrink: 0,
          }}
        />
        <span
          className="skeleton-line"
          style={{ width: '60%', height: 14, display: 'inline-block' }}
          aria-hidden
        >
          .
        </span>
      </div>

      {/* Pair 2 row. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 0',
        }}
      >
        <div
          style={{
            width: 26,
            height: 20,
            background: 'rgba(255,255,255,0.05)',
            flexShrink: 0,
          }}
        />
        <span
          className="skeleton-line"
          style={{ width: '50%', height: 14, display: 'inline-block' }}
          aria-hidden
        >
          .
        </span>
      </div>
    </div>
  )
}
