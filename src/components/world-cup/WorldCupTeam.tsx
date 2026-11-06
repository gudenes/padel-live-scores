'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import Avatar from '@/components/Avatar'
import { FlagImage } from '@/components/FlagImage'
import { MatchCard } from '@/components/MatchCard'
import { CHUNKY, MEN_BLUE, WOMEN_PURPLE } from '@/components/home/shared'
import { normalizeCountry } from '@/lib/country'
import { cupMatchDay, groupCupMatches } from '@/lib/world-cup-matches'
import { cupTeamKey, type CupData, type CupTeam } from '@/lib/world-cup'
import type { Match } from '@/types/match'
import styles from './WorldCupTeam.module.css'

/** Shared country view from standings and confrontation cards. Native dialog traps focus. */
export default function WorldCupTeam({ team, data, matches, userTz, onClose }: {
  team: CupTeam; data: CupData; matches: Match[]; userTz: string; onClose: () => void
}) {
  const t = useTranslations('worldCup')
  const locale = useLocale()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [view, setView] = useState<'squads' | 'matches'>('squads')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { element?.close(); document.body.style.overflow = overflow }
  }, [])
  const country = normalizeCountry(team.country)
  const color = team.category === 'men' ? MEN_BLUE : WOMEN_PURPLE
  const days = [...new Set(matches.map(cupMatchDay))].sort((a,b) => (a ?? '').localeCompare(b ?? ''))
  const ties = days.flatMap(day => groupCupMatches(matches, team.category, day)).filter(tie => country && tie.countries?.includes(country))
  const teamMatches = ties.flatMap(tie => tie.matches)
  const broadcasts = data.ties.filter(tie => tie.category === team.category && [tie.home, tie.away].some(name => cupTeamKey(name) === cupTeamKey(team.name))).filter(broadcast => {
    const countries = [broadcast.home, broadcast.away].map(name => normalizeCountry(data.teams.find(t => t.category === team.category && cupTeamKey(t.name) === cupTeamKey(name))?.country)).sort().join('-')
    const day = cupMatchDay({ scheduled_at: broadcast.scheduledAt ?? broadcast.liveObservedAt } as Match)
    return !ties.some(tie => tie.countries?.join('-') === countries && cupMatchDay(tie.matches[0]) === day)
  })
  const date = (value: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: userTz }).format(new Date(value))
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className={styles.content}>
      <header className={styles.header}>
        <FlagImage country={country} size={48} />
        <div><small>{t(team.category)} · FIP WORLD CUP</small><h2 id={titleId}>{country ? new Intl.DisplayNames([locale], {type:'region'}).of(country) : team.name}</h2></div>
        <button onClick={onClose} aria-label={t('closeTeam')}>×</button>
      </header>
      <nav className={styles.tabs} aria-label={t('teams')}>
        {(['squads','matches'] as const).map(tab => <button key={tab} aria-pressed={view === tab} onClick={() => setView(tab)} style={{clipPath:CHUNKY.button, ...(view === tab ? {background:color,color:'#141414'} : {})}}>{t(tab)}</button>)}
      </nav>
      {view === 'squads' ? <>
        <p className={styles.note}>{t('squadHelp')}</p>
        <ul className={styles.roster}>{team.players.map(name => {
          const profile = team.profiles?.[name]
          const content = <><Avatar src={profile?.avatarUrl} alt={profile?.name ?? name} size={44} /><span>{profile?.name ?? name}</span>{profile && <b aria-hidden="true">›</b>}</>
          return <li key={name}>{profile ? <Link href={`/player/${profile.id}`}>{content}</Link> : <div>{content}</div>}</li>
        })}</ul>
      </> : <>
        {ties.map(tie => <section key={tie.key} className={styles.matches}>
          <h3>{cupMatchDay(tie.matches[0]) ? new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',timeZone:'Asia/Qatar'}).format(new Date(tie.matches[0].scheduled_at ?? tie.matches[0].started_at ?? tie.matches[0].finished_at!)) : t('datePending')} · {tie.round ?? t('groupStage')}</h3>
          {tie.matches.map(match => <MatchCard teamCountries={tie.countries} key={match.id} match={match} genderColor={color} locale={locale} userTz={userTz} tournamentLevel="fip_championship" />)}
        </section>)}
        {broadcasts.map(tie => <div key={tie.id} className={styles.broadcast} style={{clipPath:CHUNKY.card}}><strong>{tie.home} vs {tie.away}</strong><p>{tie.liveObservedAt ? t('liveTie') : tie.scheduledAt ? `${t('broadcastTime')} · ${date(tie.scheduledAt)}` : t('datePending')}</p><p>{t('pairsPending')}</p></div>)}
        {broadcasts.length > 0 && <p className={styles.note}>{t('scheduleHelp')}</p>}
        {!teamMatches.length && !broadcasts.length && <p className={styles.note}>{t('fixturesPendingHelp')}</p>}
      </>}
    </div>
  </dialog>, document.body)
}
