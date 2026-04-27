// Per-route loading skeleton for /matches/[date]. Mirrors the sticky
// day-pill strip + filter row + first few tournament groups so the
// matches page swap-in is invisible.

import {
  SkeletonAppHeader,
  SkeletonBlock,
  SkeletonPage,
} from '@/components/skeletons/SkeletonPrimitives'

const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

function ShimmerMatchRow() {
  return (
    <div
      className="skel-block"
      style={{
        padding: '12px 14px',
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        clipPath: CHUNKY_CARD,
        marginBottom: 8,
        animation: 'skel-pulse 1.4s ease-in-out infinite',
      }}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <SkeletonBlock width={48} height={14} />
        <SkeletonBlock width={42} height={14} />
        <SkeletonBlock width={56} height={14} />
        <SkeletonBlock width={48} height={14} />
      </div>
      <SkeletonBlock width="60%" height={14} mt={4} />
      <SkeletonBlock width="50%" height={14} mt={6} />
    </div>
  )
}

function ShimmerGroup({ matches }: { matches: number }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 8px',
        }}
      >
        <div
          className="skel-block"
          style={{
            width: 28,
            height: 22,
            background: 'rgba(255,255,255,0.06)',
            animation: 'skel-pulse 1.4s ease-in-out infinite',
            clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
          }}
        />
        <div style={{ flex: 1 }}>
          <SkeletonBlock width="70%" height={14} />
          <SkeletonBlock width="40%" height={11} mt={6} />
        </div>
        <SkeletonBlock width={42} height={20} />
      </div>
      {Array.from({ length: matches }).map((_, i) => (
        <ShimmerMatchRow key={i} />
      ))}
    </div>
  )
}

export default function MatchesDateLoading() {
  return (
    <SkeletonPage>
      <SkeletonAppHeader />

      {/* Sticky day-pill + filter row */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(10,10,10,0.94)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          padding: '12px 16px 8px',
        }}
      >
        <div style={{ display: 'flex', gap: 6, overflow: 'hidden' }}>
          <SkeletonBlock width={32} height={44} shape="pill" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonBlock key={i} width={54} height={44} shape="pill" />
          ))}
          <SkeletonBlock width={32} height={44} shape="pill" />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 0 2px',
          }}
        >
          <SkeletonBlock width={92} height={32} />
        </div>
      </div>

      {/* Match-group skeleton */}
      <div style={{ padding: '0 8px' }}>
        <ShimmerGroup matches={3} />
        <ShimmerGroup matches={2} />
        <ShimmerGroup matches={2} />
      </div>

      <div style={{ height: 100 }} />
    </SkeletonPage>
  )
}
