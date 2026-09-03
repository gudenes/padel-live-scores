// Right-side drawer: Today selected-match panel for a tournament-explorer row.
'use client'

import { useEffect, useState } from 'react'
import { DetailPanel } from '@/app/(app)/today/_components/DetailPanel'
import type { Match } from '@/app/(app)/today/_lib/types'
import { flourishWinProbCsv, flourishWinProbFilename } from '@/app/(app)/today/_lib/win-prob-csv'
import { flourishCaptionsCsv, type ScoredTick } from '@/app/(app)/today/_lib/score-timeline'
import '@/app/(app)/today/scoreboard.css'

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function MatchOddsDrawer({
  matchId,
  unlinked = false,
  onClose,
}: {
  matchId: string | null
  unlinked?: boolean
  onClose: () => void
}) {
  const [match, setMatch] = useState<Match | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!matchId) {
      setMatch(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/internal/match-scoreboard?id=${encodeURIComponent(matchId)}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
        return body.match as Match
      })
      .then((m) => {
        if (!cancelled) setMatch(m)
      })
      .catch((e) => {
        if (!cancelled) {
          setMatch(null)
          setError(e instanceof Error ? e.message : 'Failed to load match')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [matchId])

  useEffect(() => {
    if (!matchId && !unlinked) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [matchId, unlinked, onClose])

  if (!matchId && !unlinked) return null

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 100,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 'var(--gh)',
          right: 0,
          bottom: 0,
          width: 400,
          background: 'var(--bg-surface)',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          animation: 'matchOddsSlideIn 0.2s ease-out',
          overflow: 'auto',
        }}
      >
        <style>{`
          @keyframes matchOddsSlideIn {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
        `}</style>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-card)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: 'var(--text-3)',
            }}
          >
            Match
          </span>
          {match && match.winProbSeries.length >= 2 ? (
            <button
              type="button"
              onClick={() => {
                const base = flourishWinProbFilename(match).replace(/\.csv$/, '')
                const ticks = match.winProbSeries as ScoredTick[]
                downloadCsv(`${base}.csv`, flourishWinProbCsv(match))
                downloadCsv(`${base}-captions.csv`, flourishCaptionsCsv(ticks))
              }}
              style={{
                marginLeft: 'auto',
                marginRight: 8,
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-1)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                padding: '4px 8px',
                borderRadius: 'var(--r-sm)',
              }}
            >
              Export CSV + captions
            </button>
          ) : (
            <span style={{ marginLeft: 'auto' }} />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 12, flex: 1 }}>
          {unlinked ? (
            <div className="sb-detail sb-detail--empty">
              This match isn&apos;t linked to public.matches yet, so there&apos;s no in-play curve to show.
            </div>
          ) : loading ? (
            <div className="sb-detail sb-detail--empty">Loading probability…</div>
          ) : error ? (
            <div className="sb-detail sb-detail--empty">{error}</div>
          ) : (
            <DetailPanel match={match} />
          )}
        </div>
      </div>
    </>
  )
}
