'use client'

import { useId, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { raceCutoffPoints, raceGap } from '@/lib/race-display'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import styles from './RaceStandings.module.css'
import type { RaceSnapshot } from '@/lib/live-race/types'

export interface RacePlayer {
  id: string
  name: string
  display_name?: string | null
  country: string | null
  avatar_url: string | null
  race_ranking: number | null
  race_points: number | null
}
interface DisplayPlayer extends RacePlayer {
  officialPoints?: number
  officialRank?: number
  liveGain?: number
  pending?: boolean
}
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const FLAGS: Record<string, string> = { ESP: 'es', ARG: 'ar', BRA: 'br', FRA: 'fr', POR: 'pt', ITA: 'it' }

function Portrait({ player, gender }: { player: RacePlayer; gender: string }) {
  const [failed, setFailed] = useState(false)
  return player.avatar_url && !failed
    ? <img loading="lazy" decoding="async" className={styles.avatar} style={{ borderColor: gender === 'women' ? '#D966FF' : '#4A9EFF' }} src={player.avatar_url} alt="" onError={() => setFailed(true)} />
    : <span className={styles.initials} aria-hidden="true">{player.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span>
}

export function RaceLiveBadge() {
  const t = useTranslations('raceStandings')
  return <span className={styles.live}>{t('live')}</span>
}

export default function RaceStandings({ players, gender, baselineDate, snapshot, query }: {
  players: DisplayPlayer[]
  gender: 'men' | 'women'
  baselineDate: string | null
  snapshot: RaceSnapshot | null
  query: string
}) {
  const t = useTranslations('raceStandings')
  const format = useFormatter()
  const [liveEnabled, setLiveEnabled] = useState(true)
  const [tipOpen, setTipOpen] = useState(false)
  const tipId = useId()
  const isLive = liveEnabled && snapshot != null && (snapshot.appliedPlayers > 0 || snapshot.pendingPlayers > 0)
  const rows = liveEnabled ? players : players.map(p => ({ ...p, race_ranking: p.officialRank ?? p.race_ranking, race_points: p.officialPoints ?? p.race_points, pending: false })).sort((a, b) => (a.race_ranking ?? Infinity) - (b.race_ranking ?? Infinity))
  const cutoff = raceCutoffPoints(rows)
  const filtered = rows.filter(player => normalize(`${player.display_name ?? player.name} ${player.country ?? ''}`).includes(normalize(query)))
  const visible = filtered
  const firstOutside = visible.find(player => (player.race_ranking ?? 0) > 16)?.id

  return <section className={styles.root} aria-label={t('title')}>
    <div className={styles.toolbar}>
      <span className={styles.count}>{t('showing', { count: rows.length })}</span>
      <div className={styles.controls}>
        {snapshot && <label className={styles.toggle}><input type="checkbox" role="switch" checked={liveEnabled} onChange={e => setLiveEnabled(e.target.checked)} />{t('live')}</label>}
        <div className={styles.help} onMouseEnter={() => setTipOpen(true)} onMouseLeave={() => setTipOpen(false)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setTipOpen(false) }} onKeyDown={e => { if (e.key === 'Escape') { setTipOpen(false); e.stopPropagation() } }}>
          <PressButton {...PRESS_PRESETS.chunkyInline} type="button" aria-label={t('how')} aria-expanded={tipOpen} aria-describedby={tipOpen ? tipId : undefined} onClick={() => setTipOpen(open => !open)} style={{ padding: '3px 8px', fontSize: 12 }}>ⓘ</PressButton>
          {tipOpen && <div id={tipId} role="tooltip" className={styles.tooltip}>
            <strong>{isLive ? t('provisional') : t('official')}</strong>
            <p>{t('explanation')}</p><p>{t('reconcile')}</p>
            <p>{t('baseline', { date: baselineDate ?? '—' })}</p>
            {snapshot && <p>{t('updated', { time: format.dateTime(new Date(snapshot.computedAt), { hour: '2-digit', minute: '2-digit' }) })}</p>}
            {!!snapshot?.pendingPlayers && <p>{t('pendingCount', { count: snapshot.pendingPlayers })}</p>}
            {snapshot?.status === 'stale' && <p>{t('stale')}</p>}
          </div>}
        </div>
      </div>
    </div>
    {liveEnabled && snapshot?.status === 'stale' && <p role="status" className={styles.notice}>{t('stale')}</p>}
    <div className={styles.columns}><span>{t('rank')}</span><span>{t('player')}</span><span>{isLive ? t('livePoints') : t('points')}</span></div>
    {!visible.length && <p className={styles.empty}>{query ? t('noResults') : t('empty')}</p>}
    {visible.map(player => {
      const outside = (player.race_ranking ?? 0) > 16
      const gap = outside ? raceGap(player.race_points, cutoff) : null
      const gain = isLive && player.officialPoints != null ? (player.race_points ?? 0) - player.officialPoints : null
      const movement = isLive && player.officialRank != null ? player.officialRank - (player.race_ranking ?? 0) : null
      const country = player.country?.toUpperCase() ?? ''
      const flag = FLAGS[country] ?? (country.length === 2 ? country.toLowerCase() : null)
      const content = <>
        <div className={styles.rank}><strong>{player.race_ranking ?? '—'}</strong>{movement !== null && movement !== 0 && <small className={movement > 0 ? styles.up : styles.down}>{movement > 0 ? '+' : '−'}{Math.abs(movement)}</small>}</div>
        <Portrait player={player} gender={gender} />
        <div className={styles.identity}><strong>{player.display_name || player.name}</strong><span>{flag && <img loading="lazy" src={`/flags/${flag}.png`} alt="" />} {country}</span></div>
        <div className={styles.points} title={gap != null ? gap === 0 ? t('tied') : t('gap', { points: format.number(gap) }) : undefined}><strong>{player.race_points == null ? '—' : format.number(player.race_points)}</strong>
          {gain != null && gain !== 0 && <small className={gain > 0 ? styles.up : styles.down}>{gain > 0 ? '+' : ''}{format.number(gain)}</small>}
          {liveEnabled && player.pending && <small title={t('verifying')} aria-label={t('verifying')}>…</small>}
        </div>
      </>
      return <div key={player.id}>
        {!query && firstOutside === player.id && cutoff != null && <div className={styles.cutoff} title={t('provisionalPlaces')}><span>{t('cutoff')}</span></div>}
        <Link href={`/player/${player.id}`} className={styles.row} data-player-id={player.id} data-gain={gain != null && gain > 0}>{content}</Link>
      </div>
    })}
  </section>
}
