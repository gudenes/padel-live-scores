// Per-route loading skeleton shown during navigation to /home.
// Mirrors the first-paint geometry of HomePage so the swap into real
// content doesn't shift the layout.

import {
  SkeletonAppHeader,
  SkeletonBlock,
  SkeletonCard,
  SkeletonPage,
} from '@/components/skeletons/SkeletonPrimitives'

export default function HomeLoading() {
  return (
    <SkeletonPage>
      <SkeletonAppHeader />

      {/* Spotlight tournament hero — large card with gradient + countdown */}
      <div style={{ padding: '12px 16px 8px' }}>
        <SkeletonCard height={170} />
      </div>

      {/* Live now strip */}
      <div style={{ padding: '8px 16px 4px' }}>
        <SkeletonBlock width={120} height={14} />
        <div style={{ marginTop: 10, display: 'flex', gap: 10, overflow: 'hidden' }}>
          <SkeletonCard height={140} style={{ minWidth: 280 }} />
          <SkeletonCard height={140} style={{ minWidth: 280 }} />
        </div>
      </div>

      {/* Upcoming carousel */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SkeletonBlock width={140} height={14} />
        <div style={{ marginTop: 10, display: 'flex', gap: 8, overflow: 'hidden' }}>
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} height={90} style={{ minWidth: 220 }} />
          ))}
        </div>
      </div>

      {/* Rankings preview */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SkeletonBlock width={120} height={14} />
        <div style={{ marginTop: 10 }}>
          <SkeletonCard height={180} />
        </div>
      </div>

      {/* News peek strip */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SkeletonBlock width={100} height={14} />
        <div style={{ marginTop: 10, display: 'flex', gap: 10, overflow: 'hidden' }}>
          <SkeletonCard height={120} style={{ minWidth: 240 }} />
          <SkeletonCard height={120} style={{ minWidth: 240 }} />
        </div>
      </div>

      {/* Bottom-nav clearance */}
      <div style={{ height: 100 }} />
    </SkeletonPage>
  )
}
