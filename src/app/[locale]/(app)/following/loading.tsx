// Per-route loading skeleton for /following. Renders a top tab bar
// shape + a list of bookmarked-match cards / followed-player rows.

import {
  SkeletonAppHeader,
  SkeletonBlock,
  SkeletonCard,
  SkeletonPage,
} from '@/components/skeletons/SkeletonPrimitives'

export default function FollowingLoading() {
  return (
    <SkeletonPage>
      <SkeletonAppHeader />

      {/* Tab bar (Bookmarks / Players / Tournaments) */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '12px 16px 8px',
        }}
      >
        <SkeletonBlock width={110} height={36} />
        <SkeletonBlock width={110} height={36} />
        <SkeletonBlock width={140} height={36} />
      </div>

      {/* Section title */}
      <div style={{ padding: '8px 16px 4px' }}>
        <SkeletonBlock width={140} height={14} />
      </div>

      {/* List of cards */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonCard key={i} height={92} />
        ))}
      </div>

      <div style={{ height: 100 }} />
    </SkeletonPage>
  )
}
