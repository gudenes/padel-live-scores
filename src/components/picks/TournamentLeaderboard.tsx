'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { LeaderboardRow, type LeaderboardRowData } from './LeaderboardRow'

const MUTED = '#6B7280'

interface TournamentOption { id: string; name: string; level: string | null }
interface LeaderboardResponse {
  rows: LeaderboardRowData[]
  nextCursor: string | null
  currentUser: { rank: number | null; row: LeaderboardRowData | null }
}

export function TournamentLeaderboard({ tournaments, defaultTournamentId }: {
  tournaments: TournamentOption[]
  defaultTournamentId: string | null
}) {
  const t = useTranslations('prediction.myPicks.leaderboard')
  const [tournamentId, setTournamentId] = useState<string | null>(defaultTournamentId)
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tournamentId) { setData(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/leaderboard?scope=tournament&tournamentId=${tournamentId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((body: LeaderboardResponse) => { if (!cancelled) { setData(body); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [tournamentId])

  if (tournaments.length === 0) {
    return <div style={{ color: MUTED, fontSize: 12, padding: '20px 0' }}>{t('noTournaments')}</div>
  }

  const meId = data?.currentUser.row?.userId
  const meIsOnPage = !!meId && data?.rows.some(r => r.userId === meId)

  return (
    <>
      <select
        value={tournamentId ?? ''}
        onChange={e => setTournamentId(e.target.value || null)}
        style={{
          width: '100%', marginBottom: 10,
          background: '#1A1A1A', color: '#fff', border: '1px solid rgba(255,255,255,0.10)',
          padding: '8px 10px', fontSize: 12,
        }}
      >
        {tournaments.map(opt => (
          <option key={opt.id} value={opt.id}>
            {opt.level ? `${opt.level.toUpperCase()} · ` : ''}{opt.name}
          </option>
        ))}
      </select>

      {loading && <div style={{ color: MUTED, fontSize: 12 }}>…</div>}
      {!loading && (!data || data.rows.length === 0) && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: MUTED }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{t('emptyTitle')}</div>
          <div style={{ fontSize: 11 }}>{t('emptyBody')}</div>
        </div>
      )}
      {!loading && data && data.rows.map(row => (
        <LeaderboardRow key={row.userId} row={row} isMe={row.userId === meId} />
      ))}
      {!loading && data?.currentUser.row && !meIsOnPage && (
        <div style={{ position: 'sticky', bottom: 8, marginTop: 12 }}>
          <LeaderboardRow row={data.currentUser.row} isMe />
        </div>
      )}
    </>
  )
}
