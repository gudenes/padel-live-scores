'use client'
// apps/ops/src/app/(app)/players/[id]/_components/PlayerProfile.tsx
// Client orchestrator for the full-profile page. Fetches the aggregator
// (/api/internal/player/[id]) on mount and renders the page chrome +
// ProfileHeader. Sections (Identity / Profile / Equipment / Match history /
// Earnings / Coaches / Activity) consume `data` here.
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
import { PageHeader, Panel, Skeleton } from '@/components/ui'

// Shape of the aggregator response. The interface is the union of fields read
// by the sections rendered so far — ProfileHeader, Identity + Profile, Match
// history. Equipment renders via EquipmentTab which fetches its own data, so the
// aggregator's `equipment` slot stays `unknown[]` here.
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
    <div className="ui-page">
      <Link
        href="/players"
        style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none' }}
      >
        ← Back to Players
      </Link>

      {state.status === 'loading' && (
        <div style={{ marginTop: 24 }}>
          <Skeleton rows={6} />
        </div>
      )}
      {state.status === 'not_found' && (
        <div style={{ marginTop: 24, fontSize: 13, color: 'var(--text-3)' }}>Player not found.</div>
      )}
      {state.status === 'error' && (
        <div style={{ marginTop: 24, fontSize: 13, color: 'var(--live-text)' }}>
          Failed to load player: {state.message}
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <div style={{ marginTop: 16, marginBottom: 22 }}>
            <PageHeader
              title={state.data.player.display_name ?? state.data.player.name}
            />
            <ProfileHeader player={state.data.player} />
          </div>

          {/* Identity + Profile side-by-side on lg, stacked on mobile. */}
          <div
            style={{
              marginBottom: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
            }}
          >
            <IdentitySection player={state.data.player} />
            <ProfileSection player={state.data.player} />
          </div>

          {/* Equipment full-width. EquipmentTab is the same component the
              drawer uses; we pass the player object so its "+ Add new racket"
              entry point can pre-fill the player in AddRacketModal step 2. */}
          <div style={{ marginBottom: 16 }}>
            <Panel title="Equipment">
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
            </Panel>
          </div>

          {/* Match history full-width. */}
          <div style={{ marginBottom: 16 }}>
            <MatchHistorySection
              playerId={state.data.player.id}
              matches={state.data.recentMatches}
            />
          </div>

          {/* Earnings + Coaches side-by-side on lg, stacked on mobile. */}
          <div
            style={{
              marginBottom: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
            }}
          >
            <EarningsSection earnings={state.data.earnings} />
            <CoachesSection coaches={state.data.player.coaches} />
          </div>

          {/* Activity placeholder — audit log not wired yet. */}
          <Panel title="Activity">
            <div style={{ fontSize: 12, color: 'var(--text-4)' }}>Audit log coming soon.</div>
          </Panel>
        </>
      )}
    </div>
  )
}
