// Per-route loading skeleton for /feed. Mirrors the news-and-highlights
// vertical list with mixed image-card heights so the swap-in feels
// stable.

import {
  SkeletonAppHeader,
  SkeletonBlock,
  SkeletonCard,
  SkeletonPage,
} from '@/components/skeletons/SkeletonPrimitives'

export default function FeedLoading() {
  return (
    <SkeletonPage>
      <SkeletonAppHeader />

      {/* Filter chips row (language / category) */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '12px 16px 8px',
          overflowX: 'auto',
        }}
      >
        {[64, 78, 92, 70, 96].map((w, i) => (
          <SkeletonBlock key={i} width={w} height={32} />
        ))}
      </div>

      {/* Vertical feed cards — mixed sizes for an organic look */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SkeletonCard height={220} />
        <SkeletonCard height={120} />
        <SkeletonCard height={180} />
        <SkeletonCard height={120} />
        <SkeletonCard height={200} />
      </div>

      <div style={{ height: 100 }} />
    </SkeletonPage>
  )
}
