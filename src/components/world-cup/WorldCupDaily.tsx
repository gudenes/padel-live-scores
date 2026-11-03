'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { MatchCard } from '@/components/MatchCard'
import { FlagImage } from '@/components/FlagImage'
import { CHUNKY, MEN_BLUE, WOMEN_PURPLE } from '@/components/home/shared'
import { WORLD_CUP, isWorldCupDay, type CupData } from '@/lib/world-cup'
import { dailyCupTies, type DailyCupTie } from '@/lib/world-cup-daily'
import type { MatchesDayGroup } from '@/lib/fetch-matches-day'
import styles from './WorldCupDaily.module.css'
import WorldCupStream from './WorldCupStream'

export function useDailyCupTies(iso: string, groups: MatchesDayGroup[], timeZone: string) {
  const [data, setData] = useState<CupData | null>(null)
  const enabled = isWorldCupDay(iso)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch('/api/world-cup', {signal:controller.signal})
        if (response.ok) setData(await response.json())
      } catch { /* Retain last successfully published fixtures. */ }
    }
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() },60000)
    return () => { controller.abort(); clearInterval(timer) }
  },[enabled])
  return enabled ? dailyCupTies(data,groups,iso,timeZone) : []
}
export default function WorldCupDaily({ties, locale, userTz, iso}: {iso:string;ties:DailyCupTie[];locale:string;userTz:string}) {
  const t = useTranslations('worldCup')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [watching, setWatching] = useState<string | null>(null)
  if (!ties.length) return null
  const regions = new Intl.DisplayNames([locale],{type:'region'})
  return <section className={styles.root} data-tour-group data-league="fip" aria-label="FIP World Cup 2026">
    <Link className={styles.header} style={{clipPath:CHUNKY.card}} href={`/tournaments/${WORLD_CUP.tournamentId}?tab=matches&day=${iso}`}>
      {/* Existing tournament artwork, with a dark scrim for readable text. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.artwork} src={WORLD_CUP.coverImage} alt="" />
      <span className={styles.bannerCopy}><small>{t('nationalTeams')}</small><strong>FIP WORLD CUP <span>2026</span></strong><span>Doha · {new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',timeZone:'UTC'}).formatRange(new Date(`${WORLD_CUP.startsOn}T12:00:00Z`),new Date(`${WORLD_CUP.endsOn}T12:00:00Z`))}</span></span>
      <span className={styles.bannerArrow} aria-hidden="true">↗</span>
    </Link>
    {ties.map(tie => {
      const key = `${iso}:${tie.key}`
      const open = expanded.has(key)
      const panelId = `daily-cup-${encodeURIComponent(key)}`
      return <div key={key} className={styles.confrontation} style={{borderLeftColor:tie.category === 'men' ? MEN_BLUE : WOMEN_PURPLE}} data-match data-category={tie.category} data-status={tie.status}>
      <div className={styles.rowHeader}>
      <button type="button" className={styles.row} aria-expanded={open} aria-controls={panelId} onClick={() => { if (open && watching === key) setWatching(null); setExpanded(previous => {
        const next = new Set(previous)
        if (next.has(key)) next.delete(key); else next.add(key)
        return next
      }) }}>
      <span className={styles.srOnly}>{t(tie.category)}</span>
      <span className={styles.teams}>
        <span className={styles.country}><FlagImage country={tie.countries[0]} size={24}/><b>{tie.countries[0] ? regions.of(tie.countries[0]) : tie.names[0]}</b></span>
        <strong className={styles.score} style={{clipPath:CHUNKY.badge}}>{tie.score ? `${tie.score[0]} – ${tie.score[1]}` : 'vs'}</strong>
        <span className={styles.country}><FlagImage country={tie.countries[1]} size={24}/><b>{tie.countries[1] ? regions.of(tie.countries[1]) : tie.names[1]}</b></span>
      </span>
      <span className={styles.meta}>{tie.score || tie.status === 'live' ? <span>{t(tie.status === 'live' ? 'liveTie' : tie.status === 'finished' ? 'finishedTie' : 'matches')}</span> : <><strong>{tie.time ? new Intl.DateTimeFormat(locale,{hour:'numeric',minute:'2-digit',timeZone:userTz}).format(new Date(tie.time)) : '—'}</strong><small>{t(tie.broadcast ? 'broadcastTime' : 'matches')}</small></>}<span aria-hidden="true">{open ? '−' : '+'}</span></span>
      </button>
      {tie.videoId && <button type="button" className={styles.watchIcon} title={t('watch')} aria-label={`${t('watch')} · ${tie.names.join(' – ')}`} aria-controls={panelId} aria-expanded={open && watching === key} onClick={() => {
        setExpanded(previous => new Set(previous).add(key))
        setWatching(open && watching === key ? null : key)
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="m10 8 6 4-6 4V8Z" fill="currentColor"/></svg>
      </button>}
      </div>
      <div id={panelId} className={styles.collapse} data-open={open} inert={!open} aria-hidden={!open}>
        <div>{open && tie.videoId && <WorldCupStream key={tie.videoId} videoId={tie.videoId} streams={tie.streams} open={watching === key} onOpenChange={value => setWatching(value ? key : null)} title={tie.countries.map((country,index) => country ? regions.of(country) : tie.names[index]).join(" – ")} />}{tie.matches.length ? tie.matches.map(match => <MatchCard embedded key={match.id} match={match} genderColor={tie.category === 'men' ? MEN_BLUE : WOMEN_PURPLE} locale={locale} userTz={userTz} tournamentLevel="fip_championship" />) : <p className={styles.pending}>{t('pairsPending')}</p>}</div>
      </div>
      </div>
    })}
  </section>
}
