'use client'
// src/app/ops/TournamentExplorerTab.tsx
//
// Tournament-centric ops view. The operator picks ONE tournament at the
// top of the page, and then switches between sub-tabs (Entry List,
// Matches, Draw) that all operate on that tournament.
//
// Design decision (2026-04-22): state is kept LOCAL to this component —
// tab selection is not persisted to the URL or localStorage. Every visit
// starts on the most-recent tournament with the Entry List subtab open.
// If we ever need shareable links we'll move to `useSearchParams`, but
// for now the ops tool is operator-only and the simple approach wins.
//
// This tab COEXISTS with the earlier "Padelgod > Entry Lists" tab. The
// standalone entry-list tab stays useful for raw snapshot triage; the
// explorer is the new "per-tournament deep dive" surface.

import { useEffect, useState } from 'react'
import PadelgodEntryListTab from './PadelgodEntryListTab'
import TournamentMatchesSubtab from './tournament/TournamentMatchesSubtab'
import TournamentDrawSubtab from './tournament/TournamentDrawSubtab'

// ── Types (mirror /api/ops/tournament-explorer response) ────────────────

interface TournamentWithSources {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  source: string | null
  level: string | null
  country: string | null
  logo_url: string | null
  entryListCapturedAt: string | null
  oopCapturedAt: string | null
  resultsCapturedAt: string | null
  drawCapturedAt: string | null
}

type SubTab = 'entryList' | 'matches' | 'draw'

// ── Styles ──────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function tournamentLabel(t: TournamentWithSources): string {
  const bits: string[] = [t.name]
  if (t.starts_at) bits.push(t.starts_at.slice(0, 10))
  if (t.level) bits.push(t.level.toUpperCase())
  if (t.country) bits.push(t.country)
  return bits.join(' · ')
}

// ── Component ───────────────────────────────────────────────────────────

export default function TournamentExplorerTab() {
  const [tournaments, setTournaments] = useState<TournamentWithSources[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [subTab, setSubTab] = useState<SubTab>('entryList')

  // Fetch list on mount.
  useEffect(() => {
    setLoadingList(true)
    setListError(null)
    fetch('/api/ops/tournament-explorer')
      .then((r) => r.json())
      .then((data: { tournaments?: TournamentWithSources[]; error?: string }) => {
        if (data.error) {
          setListError(data.error)
          return
        }
        const list = data.tournaments ?? []
        setTournaments(list)
        if (list.length > 0) setSelectedId(list[0]!.id)
      })
      .catch((e) => setListError(e instanceof Error ? e.message : 'Failed to load list'))
      .finally(() => setLoadingList(false))
  }, [])

  const selected = tournaments.find((t) => t.id === selectedId) ?? null

  return (
    <div>
      {/* Intro */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#111' }}>
          Tournament Explorer
        </h2>
        <p style={{ fontSize: 12, color: '#666', marginTop: 4, maxWidth: 720 }}>
          One tournament, all padelgod data in one place. Pick a tournament
          above, then switch between Entry List, Matches, and Draw to audit
          what the padelgod scrapers captured. Read-only — useful as a
          sanity check before migrating match creation authority away from
          padelapi.
        </p>
      </div>

      {/* Tournament picker card */}
      <div style={{ ...card, marginBottom: 16 }}>
        {listError && (
          <div style={{ color: '#991b1b', fontSize: 12, marginBottom: 8 }}>
            ❌ {listError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label
              style={{
                display: 'block',
                fontSize: 10,
                fontWeight: 600,
                color: '#999',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              Tournament
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={loadingList || tournaments.length === 0}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: '#fff',
                color: '#333',
              }}
            >
              {loadingList && <option value="">Loading…</option>}
              {!loadingList && tournaments.length === 0 && (
                <option value="">No padelgod tournaments in the last 60 days</option>
              )}
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {tournamentLabel(t)}
                </option>
              ))}
            </select>
          </div>
          {selected && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, auto)',
                gap: 12,
                fontSize: 11,
                color: '#555',
              }}
            >
              <FreshnessTile label="Entry List" at={selected.entryListCapturedAt} />
              <FreshnessTile label="OOP" at={selected.oopCapturedAt} />
              <FreshnessTile label="Results" at={selected.resultsCapturedAt} />
              <FreshnessTile label="Draw" at={selected.drawCapturedAt} />
            </div>
          )}
        </div>
      </div>

      {/* Sub-tab nav */}
      {selected && (
        <>
          <div style={{ display: 'flex', gap: 2, marginBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
            <SubTabButton
              label="Entry List"
              active={subTab === 'entryList'}
              onClick={() => setSubTab('entryList')}
              hasData={Boolean(selected.entryListCapturedAt)}
            />
            <SubTabButton
              label="Matches"
              active={subTab === 'matches'}
              onClick={() => setSubTab('matches')}
              hasData={Boolean(selected.oopCapturedAt || selected.resultsCapturedAt)}
            />
            <SubTabButton
              label="Draw"
              active={subTab === 'draw'}
              onClick={() => setSubTab('draw')}
              hasData={Boolean(selected.drawCapturedAt)}
            />
          </div>

          {/* Sub-tab body */}
          {subTab === 'entryList' && <PadelgodEntryListTab tournamentId={selected.id} />}
          {subTab === 'matches' && <TournamentMatchesSubtab tournamentId={selected.id} />}
          {subTab === 'draw' && <TournamentDrawSubtab tournamentId={selected.id} />}
        </>
      )}

      {!selected && !loadingList && tournaments.length === 0 && !listError && (
        <div style={{ ...card, color: '#666', fontSize: 12 }}>
          No tournaments to explore. Padelgod only captures active
          tournaments — wait for the next scrape cycle.
        </div>
      )}
    </div>
  )
}

// ── Small atoms ─────────────────────────────────────────────────────────

function FreshnessTile({ label, at }: { label: string; at: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: at ? '#333' : '#bbb' }}>
        {formatAgo(at)}
      </div>
    </div>
  )
}

function SubTabButton({
  label,
  active,
  onClick,
  hasData,
}: {
  label: string
  active: boolean
  onClick: () => void
  hasData: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? '#111' : hasData ? '#555' : '#bbb',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #111' : '2px solid transparent',
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {label}
      {!hasData && (
        <span style={{ fontSize: 9, color: '#bbb', marginLeft: 6, fontWeight: 500 }}>
          (no data)
        </span>
      )}
    </button>
  )
}
