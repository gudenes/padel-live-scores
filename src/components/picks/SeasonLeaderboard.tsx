'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { LeaderboardRow, type LeaderboardRowData } from './LeaderboardRow'

const MUTED = '#6B7280'

interface LeaderboardResponse {
  rows: LeaderboardRowData[]
  nextCursor: string | null
  currentUser: { rank: number | null; row: LeaderboardRowData | null }
}

export function SeasonLeaderboard({ seasonId }: { seasonId: number }) {
  const t = useTranslations('prediction.myPicks.leaderboard')
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/leaderboard?scope=season&seasonId=${seasonId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((body: LeaderboardResponse) => { if (!cancelled) { setData(body); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [seasonId])

  if (loading) return <div style={{ color: MUTED, fontSize: 12, padding: '20px 0' }}>…</div>
  if (error) return <div style={{ color: MUTED, fontSize: 12, padding: '20px 0' }}>{t('errorBody')}</div>
  if (!data || data.rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: MUTED }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{t('emptyTitle')}</div>
        <div style={{ fontSize: 11 }}>{t('emptyBody')}</div>
      </div>
    )
  }

  const meId = data.currentUser.row?.userId
  const meIsOnPage = !!meId && data.rows.some(r => r.userId === meId)

  return (
    <>
      <div>
        {data.rows.map(row => (
          <LeaderboardRow key={row.userId} row={row} isMe={row.userId === meId} />
        ))}
      </div>
      {data.currentUser.row && !meIsOnPage && (
        <div style={{ position: 'sticky', bottom: 8, marginTop: 12 }}>
          <LeaderboardRow row={data.currentUser.row} isMe />
        </div>
      )}
    </>
  )
}
