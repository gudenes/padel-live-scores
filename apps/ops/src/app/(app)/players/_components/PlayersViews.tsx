'use client'
// Players · Coaches · Review queue. Coaches live inside the Players tab
// (decided 2026-10-02) so a player-turned-coach is one click away.
// The view is in the URL (?view=coaches) so it's linkable.

import React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Pill } from '@/components/ui'
import PlayersTab from './PlayersTab'
import CoachesView from './CoachesView'
import CoachReviewQueue from './CoachReviewQueue'

const VIEWS = [
  { key: 'players', label: 'Players' },
  { key: 'coaches', label: 'Coaches' },
  { key: 'review', label: 'Review queue' },
] as const
type View = (typeof VIEWS)[number]['key']

const chipBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', borderRadius: 'var(--r-full)' }

export default function PlayersViews() {
  const params = useSearchParams()
  const router = useRouter()
  const raw = params.get('view')
  const view: View = raw === 'coaches' || raw === 'review' ? raw : 'players'

  const setView = (v: View) => {
    const next = new URLSearchParams(params.toString())
    if (v === 'players') next.delete('view')
    else next.set('view', v)
    const qs = next.toString()
    router.replace(qs ? `/players?${qs}` : '/players')
  }

  return (
    <>
      <div className="ui-page" style={{ paddingBottom: 0, display: 'flex', gap: 8 }}>
        {VIEWS.map((v) => (
          <button key={v.key} type="button" style={chipBtn} onClick={() => setView(v.key)} aria-pressed={view === v.key}>
            <Pill tone={view === v.key ? 'lime' : 'neutral'}>{v.label}</Pill>
          </button>
        ))}
      </div>
      {view === 'players' && <PlayersTab />}
      {view === 'coaches' && <CoachesView />}
      {view === 'review' && <CoachReviewQueue />}
    </>
  )
}
