// src/components/skeletons/DetailPageSkeleton.tsx
//
// Shared shimmer skeleton for the three drill-in detail routes
// (match / tournament / player). Replaces the BrandedLoader spinner
// previously shown during their internal client-side fetch state, so
// the slide-from-right transition lands on a layout-shaped placeholder
// instead of a centred spinner — much smoother perceived flow.
//
// Why one generic skeleton vs three bespoke ones: the three pages
// share a near-identical first paint (top bar with back button and
// title → hero card with primary identity → a couple of content
// cards below). Tightening the skeleton further per-page would risk
// it diverging when those pages change. A shared, slightly looser
// skeleton stays correct for all three at the cost of being a hint
// less specific.

import { SKELETON_KEYFRAMES, SkeletonBlock } from './SkeletonPrimitives'

const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

interface DetailPageSkeletonProps {
  /** Optional title text in the top bar (e.g. "Match", "Tournament").
   *  Renders a faint placeholder bar; pass nothing to skip the title. */
  variant?: 'match' | 'tournament' | 'player'
}

export default function DetailPageSkeleton({
  variant = 'match',
}: DetailPageSkeletonProps) {
  return (
    <div style={{ background: BG_BASE, minHeight: '100vh' }}>
      <style dangerouslySetInnerHTML={{ __html: SKELETON_KEYFRAMES }} />

      {/* ── Top bar — back arrow + title placeholder + optional action ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 14px 12px',
          borderBottom: `1px solid ${BORDER}`,
          background: BG_BASE,
        }}
      >
        <SkeletonBlock width={30} height={30} rounded />
        <div style={{ flex: 1 }}>
          <SkeletonBlock width={140} height={16} />
        </div>
        <SkeletonBlock width={30} height={30} rounded />
      </div>

      {/* ── Hero card — large identity block (winner / tournament name /
              player avatar+name). Subtle gradient under the shimmer
              hints at the colored hero on the real pages. ─────────── */}
      <div
        style={{
          padding: '20px 16px 18px',
          background:
            variant === 'player'
              ? 'linear-gradient(135deg, #0e0e1e, #0a0a0a)'
              : 'linear-gradient(135deg, #0e1a0e, #0a0a0a)',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        {variant === 'player' ? (
          <SkeletonBlock width={64} height={64} rounded />
        ) : (
          <SkeletonBlock width={48} height={48} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <SkeletonBlock width="60%" height={9} />
          <SkeletonBlock width="85%" height={20} mt={8} />
          <SkeletonBlock width="40%" height={11} mt={8} />
        </div>
      </div>

      {/* ── Secondary block — for match: tournament row.
              For tournament/player: stat row. ─────────────────────── */}
      <div
        style={{
          padding: '14px 16px',
          background: BG_CARD,
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <SkeletonBlock width={70} height={9} />
        <SkeletonBlock width="50%" height={14} />
      </div>

      {/* ── Content cards ── */}
      {variant === 'match' && <MatchScoreSkeleton />}
      {variant === 'tournament' && <TournamentTabsSkeleton />}
      {variant === 'player' && <PlayerStatsSkeleton />}

      <div
        className="skel-block"
        style={{
          margin: '14px 14px',
          padding: 14,
          background: BG_CARD,
          border: `1px solid ${BORDER}`,
          clipPath: CHUNKY_CARD,
          height: 90,
          animation: 'skel-pulse 1.4s ease-in-out infinite',
        }}
      />

      <div style={{ height: 80 }} />
    </div>
  )
}

function MatchScoreSkeleton() {
  return (
    <div
      style={{
        padding: '16px 14px',
        borderBottom: `1px solid ${BORDER}`,
        background: BG_BASE,
      }}
    >
      <SkeletonBlock width={180} height={9} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        {[0, 1].map((row) => (
          <div key={row} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SkeletonBlock width={48} height={48} />
            <SkeletonBlock width={48} height={48} />
            <div style={{ flex: 1 }}>
              <SkeletonBlock width="80%" height={14} />
              <SkeletonBlock width="55%" height={12} mt={6} />
            </div>
            <SkeletonBlock width={26} height={22} />
            <SkeletonBlock width={26} height={22} />
          </div>
        ))}
      </div>
    </div>
  )
}

function TournamentTabsSkeleton() {
  return (
    <div style={{ padding: '14px 16px', background: BG_BASE }}>
      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <SkeletonBlock width={70} height={28} />
        <SkeletonBlock width={70} height={28} />
        <SkeletonBlock width={70} height={28} />
      </div>
      {/* Two card rows */}
      {[0, 1].map((i) => (
        <div
          key={i}
          className="skel-block"
          style={{
            padding: '12px 14px',
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            clipPath: CHUNKY_CARD,
            marginBottom: 10,
            animation: 'skel-pulse 1.4s ease-in-out infinite',
          }}
        >
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <SkeletonBlock width={48} height={14} />
            <SkeletonBlock width={56} height={14} />
          </div>
          <SkeletonBlock width="62%" height={14} mt={4} />
          <SkeletonBlock width="50%" height={14} mt={6} />
        </div>
      ))}
    </div>
  )
}

function PlayerStatsSkeleton() {
  return (
    <div style={{ padding: '14px 16px', background: BG_BASE }}>
      {/* 3-up KPI row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          marginBottom: 14,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="skel-block"
            style={{
              padding: '12px 8px',
              background: BG_CARD,
              border: `1px solid ${BORDER}`,
              clipPath: CHUNKY_CARD,
              animation: 'skel-pulse 1.4s ease-in-out infinite',
              textAlign: 'center',
            }}
          >
            <SkeletonBlock width={40} height={20} ml={0} />
            <SkeletonBlock width={50} height={10} mt={6} />
          </div>
        ))}
      </div>
      {/* 2 stat rows */}
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            padding: '10px 14px',
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            clipPath: CHUNKY_CARD,
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <SkeletonBlock width={28} height={28} rounded />
          <div style={{ flex: 1 }}>
            <SkeletonBlock width="70%" height={12} />
            <SkeletonBlock width="40%" height={10} mt={4} />
          </div>
          <SkeletonBlock width={36} height={16} />
        </div>
      ))}
    </div>
  )
}
