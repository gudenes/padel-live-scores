'use client'
// apps/ops/src/app/(app)/players/[id]/_components/PlayerProfile.tsx
// Client orchestrator for the full-profile page. Fetches the aggregator
// (/api/internal/player/[id]) on mount and renders the page chrome +
// ProfileHeader. Sections (Identity / Profile / Equipment / Match history /
// Earnings / Coaches / Activity) land in C2–C4 and consume `data` here.
//
// Client-side fetch sidesteps the auth-cookie forwarding gymnastics that
// server-side fetch in Next 16 would otherwise require, and mirrors the
// pattern used by sibling components (EquipmentTab).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import ProfileHeader, { type ProfileHeaderPlayer } from './ProfileHeader'
import IdentitySection, { type IdentitySectionPlayer } from './IdentitySection'
import ProfileSection, { type ProfileSectionPlayer } from './ProfileSection'

// Shape of the aggregator response. The interface is the union of fields read
// by the sections rendered so far — ProfileHeader (C1), Identity + Profile
// (C2). C3/C4 will extend this with whatever extra columns they consume.
interface AggregatorPlayer
  extends ProfileHeaderPlayer,
    IdentitySectionPlayer,
    ProfileSectionPlayer {}

interface AggregatorResponse {
  player: AggregatorPlayer
  equipment: unknown[]
  recentMatches: unknown[]
  earnings: unknown[]
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: AggregatorResponse }
  | { status: 'not_found' }
  | { status: 'error'; message: string }

export default function PlayerProfile({ playerId }: { playerId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    // Initial state is 'loading'; if playerId ever changes mid-mount we'd want
    // to reset, but Next remounts on route change so the initial value is enough.
    let cancelled = false

    fetch(`/api/internal/player/${playerId}`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) {
          setState({ status: 'not_found' })
          return
        }
        if (!res.ok) {
          setState({ status: 'error', message: `HTTP ${res.status}` })
          return
        }
        const data = (await res.json()) as AggregatorResponse
        setState({ status: 'ready', data })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to load'
        setState({ status: 'error', message })
      })

    return () => {
      cancelled = true
    }
  }, [playerId])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/players" className="text-xs text-gray-500 hover:text-gray-900">
        ← Back to Players
      </Link>
      {state.status === 'loading' && (
        <div className="mt-6 text-sm text-gray-400">Loading…</div>
      )}
      {state.status === 'not_found' && (
        <div className="mt-6 text-sm text-gray-500">Player not found.</div>
      )}
      {state.status === 'error' && (
        <div className="mt-6 text-sm text-red-600">
          Failed to load player: {state.message}
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <div className="mt-4">
            <ProfileHeader player={state.data.player} />
          </div>
          {/* Identity + Profile (C2). Equipment + Match history (C3) and
              Earnings + Coaches + Activity (C4) will land below this grid. */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <IdentitySection player={state.data.player} />
            <ProfileSection player={state.data.player} />
          </div>
        </>
      )}
    </div>
  )
}
