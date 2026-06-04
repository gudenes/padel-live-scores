// apps/ops/src/app/(app)/today/_components/ConnectionBanner.tsx
// Connection-state banner for the Today scoreboard. Renders nothing while live/loading.
// Reconnecting → orange notice + spinner. Offline → red notice + Retry.
'use client'
import type { ConnectionState } from '../_lib/types'

export function ConnectionBanner({
  connection,
  onRetry,
}: {
  connection: ConnectionState
  onRetry?: () => void
}) {
  if (connection === 'live' || connection === 'loading') return null

  if (connection === 'reconnecting') {
    return (
      <div className="sb-banner sb-banner--warn" role="status" aria-live="polite">
        <span className="sb-spinner" aria-hidden="true" />
        <span>Reconnecting…</span>
      </div>
    )
  }

  return (
    <div className="sb-banner sb-banner--err" role="alert" aria-live="assertive">
      <span className="sb-banner-dot" aria-hidden="true" />
      <span>Connection lost — showing the last known state.</span>
      {onRetry ? (
        <button type="button" className="sb-banner-retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}
