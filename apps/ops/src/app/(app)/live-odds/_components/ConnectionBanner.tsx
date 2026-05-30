// apps/ops/src/app/(app)/live-odds/_components/ConnectionBanner.tsx
import type { ConnectionState } from '../_lib/types'
import { Icon } from './icons'

const TEXT: Partial<Record<ConnectionState, [string, string]>> = {
  reconnecting: ['Reconnecting to Padelgod feed', 'last update 14s ago'],
  offline: ['Padelgod feed disconnected — odds frozen', 'frozen at 09:42:18 · auto-retry 5s'],
}
export function ConnectionBanner({ state, onRetry }: { state: ConnectionState; onRetry: () => void }) {
  const t = TEXT[state]
  if (!t) return null
  return (
    <div className="connbanner">
      <span className="cb-ic"><Icon id="retry" /></span>
      <span>{t[0]}</span>
      <span className="cb-meta">{t[1]}</span>
      {state === 'offline' && <button className="cb-retry" onClick={onRetry}>Retry now</button>}
    </div>
  )
}
