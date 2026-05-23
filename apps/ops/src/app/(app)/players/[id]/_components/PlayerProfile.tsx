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
import MatchHistorySection, { type MatchHistoryRow } from './MatchHistorySection'
import EarningsSection, { type Earning } from './EarningsSection'
import CoachesSection from './CoachesSection'
import EquipmentTab from '../../_components/EquipmentTab'

// Shape of the aggregator response. The interface is the union of fields read
// by the sections rendered so far — ProfileHeader (C1), Identity + Profile
// (C2), Match history (C3). C4 will extend this with whatever extra columns
// it consumes. Equipment renders via EquipmentTab which fetches its own data,
// so the aggregator's `equipment` slot stays `unknown[]` here.
interface AggregatorPlayer
  extends ProfileHeaderPlayer,
    IdentitySectionPlayer,
    ProfileSectionPlayer {}

interface AggregatorResponse {
  player: AggregatorPlayer
  equipment: unknown[]
  recentMatches: MatchHistoryRow[]
  earnings: Earning[]
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
          {/* Identity + Profile (C2). Equipment + Match history (C3) land
              full-width below. Earnings + Coaches + Activity (C4) follow. */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <IdentitySection player={state.data.player} />
            <ProfileSection player={state.data.player} />
          </div>
          {/* Equipment full-width. EquipmentTab is the same component the
              drawer uses; we pass the player object so its "+ Add new racket"
              entry point can pre-fill the player in AddRacketModal step 2. */}
          <section className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Equipment</h2>
            <EquipmentTab
              playerId={state.data.player.id}
              player={{
                id: state.data.player.id,
                name: state.data.player.name,
                display_name: state.data.player.display_name,
                country: state.data.player.country,
                ranking: state.data.player.ranking,
                category:
                  state.data.player.category === 'men' ||
                  state.data.player.category === 'women'
                    ? state.data.player.category
                    : null,
                avatar_url: state.data.player.avatar_url,
              }}
            />
          </section>
          {/* Match history full-width. */}
          <div className="mt-4">
            <MatchHistorySection
              playerId={state.data.player.id}
              matches={state.data.recentMatches}
            />
          </div>
          {/* Earnings + Coaches side-by-side on lg, stacked on mobile. */}
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EarningsSection earnings={state.data.earnings} />
            <CoachesSection coaches={state.data.player.coaches} />
          </div>
          {/* Activity placeholder — audit log not wired yet. */}
          <section className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Activity</h2>
            <div className="text-xs text-gray-400">Audit log coming soon.</div>
          </section>
        </>
      )}
    </div>
  )
}
