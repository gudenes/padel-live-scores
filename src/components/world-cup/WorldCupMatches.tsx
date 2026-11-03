'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { MatchCard } from '@/components/MatchCard'
import EmptyState from '@/components/EmptyState'
import MatchCardSkeleton from '@/components/skeletons/MatchCardSkeleton'
import { FlagImage } from '@/components/FlagImage'
import { CUP_DAYS, groupCupMatches, cupTieScore, type CountryConfrontation } from '@/lib/world-cup-matches'
import { cupTeamKey, type CupCategory, type CupData, type CupTeam } from '@/lib/world-cup'
import { normalizeCountry } from '@/lib/country'
import type { Match } from '@/types/match'
import { MEN_BLUE, WOMEN_PURPLE, CHUNKY } from '@/components/home/shared'
import WorldCupTeam from './WorldCupTeam'
import WorldCupStream from './WorldCupStream'
import styles from './WorldCupMatches.module.css'
import dailyStyles from './WorldCupDaily.module.css'

export default function WorldCupMatches({ matches, category, onCategoryChange, loading, userTz }: {
  matches: Match[]; category: CupCategory; onCategoryChange: (category: CupCategory) => void; loading: boolean; userTz: string
}) {
  const searchParams = useSearchParams()
  const t = useTranslations('worldCup')
  const tTournament = useTranslations('tournament')
  const locale = useLocale()
  const [cup, setCup] = useState<CupData | null>(null)
  const [selectedTeam, setSelectedTeam] = useState<CupTeam | null>(null)
  const [openTies, setOpenTies] = useState<Set<string>>(new Set())
  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch('/api/world-cup', { signal: controller.signal })
        if (response.ok) setCup(await response.json())
      } catch { /* Keep the last successful schedule. */ }
    }
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  const dayStrip = useRef<HTMLDivElement>(null)
  const [day, setDay] = useState(() => {
    const requested = CUP_DAYS.find(day => day.date === searchParams.get('day'))
    if (requested) return requested.date
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    return today < CUP_DAYS[0].date ? CUP_DAYS[0].date : today > CUP_DAYS[5].date ? CUP_DAYS[5].date : today
  })
  useEffect(() => {
    const strip = dayStrip.current
    const active = strip?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    if (!strip || !active) return
    strip.scrollTo({ left: active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [day])
  const selected = CUP_DAYS.find(d => d.date === day) ?? CUP_DAYS[0]
  const ties = groupCupMatches(matches, category, day)
  const undated = groupCupMatches(matches, category, null)
  const region = new Intl.DisplayNames([locale], { type: 'region' })
  const color = category === 'men' ? MEN_BLUE : WOMEN_PURPLE
  const teamCountry = (name: string) => normalizeCountry(cup?.teams.find(team => team.category === category && cupTeamKey(team.name) === cupTeamKey(name))?.country)
  const broadcasts = (cup?.ties ?? []).filter(tie => tie.category === category && (tie.scheduledAt || tie.liveObservedAt) &&
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date((tie.scheduledAt ?? tie.liveObservedAt)!)) === day)
  const pending = broadcasts.filter(broadcast => {
    const countries = [teamCountry(broadcast.home), teamCountry(broadcast.away)].sort().join('-')
    return !ties.some(tie => tie.countries?.join('-') === countries)
  })
  const toggleTie = (key: string) => setOpenTies(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const countryLabel = (country: string | null, name?: string) => {
    const team = cup?.teams.find(team => team.category === category && normalizeCountry(team.country) === country)
    const label = country ? region.of(country) : name
    return <span className={dailyStyles.country}>
      {team ? <button type="button" className={styles.flagButton} aria-label={`${label} · ${t('teamDetails')}`} onClick={() => setSelectedTeam(team)}><FlagImage country={country} size={24} /></button> : <FlagImage country={country} size={24} />}
      <b>{label}</b>
    </span>
  }
  const renderTie = (tie: CountryConfrontation) => {
    const expanded = openTies.has(tie.key)
    const score = cupTieScore(tie)
    const stream = tie.countries && broadcasts.find(broadcast =>
      [teamCountry(broadcast.home), teamCountry(broadcast.away)].sort().join('-') === tie.countries?.join('-') &&
      tie.key.startsWith(`${day}:`))
    const panelId = `cup-${encodeURIComponent(tie.key)}`
    const live = tie.matches.some(match => ['live', 'on_court'].includes(match.status))
    const finished = tie.matches.length >= 3 && tie.matches.every(match => ['finished', 'ended', 'retired', 'walkover'].includes(match.status))
    return <section className={dailyStyles.confrontation} style={{borderLeftColor:color}} key={tie.key}>
      <div className={`${dailyStyles.row} ${styles.tieRow}`}>
        <button type="button" className={styles.expandButton} aria-label={tie.countries ? `${region.of(tie.countries[0])} – ${region.of(tie.countries[1])}` : t('unassignedTie')} aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleTie(tie.key)} />
        <span className={dailyStyles.teams}>
          {tie.countries ? <>
            {countryLabel(tie.countries[0])}
            <strong className={dailyStyles.score} style={{clipPath:CHUNKY.badge}}>{score ? `${score[0]} – ${score[1]}` : 'vs'}</strong>
            {countryLabel(tie.countries[1])}
          </> : <span>{t('unassignedTie')}</span>}
        </span>
        <span className={dailyStyles.meta}><small>{live ? t('liveTie') : finished ? t('finishedTie') : `${tie.round ?? t(selected.stage)} · ${t('matchCount', { count: tie.matches.length })}`}</small><span aria-hidden="true">{expanded ? '−' : '+'}</span></span>
      </div>
      <div id={panelId} className={dailyStyles.collapse} data-open={expanded} inert={!expanded} aria-hidden={!expanded}>
        <div>{expanded && stream && <WorldCupStream key={stream.videoId} videoId={stream.videoId} title={`${stream.home} – ${stream.away}`} />}{tie.matches.map(match => <MatchCard embedded key={match.id} match={match} genderColor={color} locale={locale} userTz={userTz} tournamentLevel="fip_championship" />)}</div>
      </div>
    </section>
  }
  return <section className={styles.root} aria-label={t('matches')}>
    <div className={styles.categories}>
      {(['men', 'women'] as const).map(g => <button key={g} aria-pressed={g === category} onClick={() => onCategoryChange(g)} style={g === category ? { color: g === 'men' ? MEN_BLUE : WOMEN_PURPLE, borderBottomColor: g === 'men' ? MEN_BLUE : WOMEN_PURPLE } : undefined}>{t(g)}</button>)}
    </div>
    <div ref={dayStrip} className={styles.days} aria-label={t('eventDays')}>
      {CUP_DAYS.map(d => <button key={d.date} aria-pressed={day === d.date} onClick={() => setDay(d.date)} style={{ clipPath: CHUNKY.button }}>
        <b>{t(d.stage)}</b>
        <span>{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d.date}T12:00:00Z`))}</span>
      </button>)}
    </div>
    <h2 className={styles.stage}>{t(selected.stage)}</h2>
    {day >= '2026-11-05' && <p className={styles.note}>{t('placementMatches')}</p>}
    {loading ? <MatchCardSkeleton /> : (ties.length || pending.length) ? ties.map(renderTie) : <div className={styles.empty}>
      <EmptyState title={tTournament('placeholder.headline')} subtitle={tTournament('placeholder.body')} />
    </div>}
    {!loading && pending.map(tie => {
      const expanded = openTies.has(tie.id)
      const panelId = `cup-pending-${encodeURIComponent(tie.id)}`
      const countries = [teamCountry(tie.home), teamCountry(tie.away)]
      return <section key={tie.id} className={dailyStyles.confrontation} style={{borderLeftColor:color}}>
        <div className={`${dailyStyles.row} ${styles.tieRow}`}>
          <button type="button" className={styles.expandButton} aria-label={`${tie.home} – ${tie.away}`} aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleTie(tie.id)} />
          <span className={dailyStyles.teams}>
            {countryLabel(countries[0], tie.home)}
            <strong className={dailyStyles.score} style={{clipPath:CHUNKY.badge}}>vs</strong>
            {countryLabel(countries[1], tie.away)}
          </span>
          <span className={dailyStyles.meta}><strong>{tie.liveObservedAt ? t('liveTie') : tie.scheduledAt ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: userTz }).format(new Date(tie.scheduledAt)) : '—'}</strong><small>{!tie.liveObservedAt && t('broadcastTime')}{tie.group ? ` · ${t('group')} ${tie.group}` : ''}</small><span aria-hidden="true">{expanded ? '−' : '+'}</span></span>
        </div>
        <div id={panelId} className={dailyStyles.collapse} data-open={expanded} inert={!expanded} aria-hidden={!expanded}>
          <div>{expanded && <WorldCupStream key={tie.videoId} videoId={tie.videoId} title={`${tie.home} – ${tie.away}`} />}<p className={dailyStyles.pending}>{t('pairsPending')}</p></div>
        </div>
      </section>
    })}
    {!loading && pending.length > 0 && <p className={styles.note}>{t('scheduleHelp')}</p>}
    {selectedTeam && cup && <WorldCupTeam team={selectedTeam} data={cup} matches={matches} userTz={userTz} onClose={() => setSelectedTeam(null)} />}
    {!loading && undated.length > 0 && <div><h2 className={styles.stage}>{t('datePending')}</h2>{undated.map(renderTie)}</div>}
  </section>
}
