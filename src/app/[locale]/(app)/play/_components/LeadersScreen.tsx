'use client'

import RankingInfo from './RankingInfo'
import {SearchIcon} from '@/components/icons'
import PredictionRate from '@/components/player/PredictionRate'
// src/app/[locale]/(app)/play/_components/LeadersScreen.tsx
//
// Rank by settled net winnings; purchases do not affect scores.

import {useMemberFollows} from './useMemberFollows'
import {leaderboardWeek} from '@/lib/leaderboard-week'
import { Fragment, useEffect, useRef, useState } from 'react'
import {MemberAvatar} from '@/components/player/MemberAvatar'
import GuacaCoin from '@/components/GuacaCoin'
import { useLocale, useTranslations } from 'next-intl'
import { simulationPlayerLook, simulationPlayerWardrobe } from '@/lib/player-outfit'
import Avatar from '@/components/Avatar'
import { PlayerAvatar, PlayerFigure } from '@/components/PlayerAvatar'
import { useRouter } from '@/i18n/navigation'
import styles from './LeadersScreen.module.css'
import { Blank, Press, SkeletonList, formatGuacas } from './shared'
import type { LeaderPeriod, PlayLeader, PlayLeaderboard } from './types'
import type { LoadStatus } from './usePlayData'

const PERIODS: LeaderPeriod[] = ['week', 'season']

/**
 * Rank movement. /api/play/leaderboard does not compute it yet, and an
 * absent value renders NOTHING — a dash in every row would read as "nobody
 * moved this week", which is a claim, not a gap. A real 0 does get the dash.
 */
function Move({ move }: { move: number | null }) {
  if (move === null) return null
  if (move === 0) return <div className="pl-m2 pl-flat">—</div>
  if (move > 0) return <div className="pl-m2 pl-up">▲ {move}</div>
  return <div className="pl-m2 pl-down">▼ {Math.abs(move)}</div>
}

/** Member appearances come from their saved wardrobe on every device. */
function LeaderAvatar({ leader, size = 44 }: { leader: PlayLeader; size?: number }) {
  const fallback = leader.avatarUrl ? <Avatar src={leader.avatarUrl} alt="" size={size} unoptimized /> : <PlayerAvatar outfit="starter" size={size} />
  if (leader.isSimulation) return <PlayerAvatar outfit={simulationPlayerLook(leader.avatarSeed || leader.displayName)} wardrobe={simulationPlayerWardrobe(leader.avatarSeed || leader.displayName)} approvedArtwork size={size} />
  return leader.userId ? <MemberAvatar userId={leader.userId} size={size} fallback={fallback}/> : fallback
}

export interface LeadersScreenProps {
  weekOffset?: number
  onWeek?: (offset:number)=>void
  available?: number | null
  active: boolean
  board: PlayLeaderboard | null
  status: LoadStatus
  period: LeaderPeriod
  onPeriod: (p: LeaderPeriod) => void
  onOpenMarkets?: () => void
  onRetry: () => void
}

export default function LeadersScreen({
  active,
  weekOffset=0,
  onWeek,
  available,
  board,
  status,
  period,
  onPeriod,
  onRetry,
  onOpenMarkets,
}: LeadersScreenProps) {
  const t = useTranslations('play')
  const locale = useLocale()
  const follows=useMemberFollows(active)
  const [followingOnly,setFollowingOnly]=useState(false)
  const [history,setHistory]=useState(false)
  const [searchOpen,setSearchOpen]=useState(false)
  const [query,setQuery]=useState('')
  const searchInput=useRef<HTMLInputElement>(null)
  useEffect(()=>{if(new URLSearchParams(window.location.search).get('search')==='1')setSearchOpen(true)},[])
  useEffect(()=>{if(searchOpen)searchInput.current?.focus()},[searchOpen])
  const week=leaderboardWeek(weekOffset)
  const dateLabel=(date:string)=>new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date))
  const router = useRouter()

  const list = useRef<HTMLDivElement>(null)
  const ownRow = useRef<HTMLButtonElement>(null)
  const [selected, setSelected] = useState<PlayLeader | null>(null)
  const [expanded, setExpanded] = useState(false)
  const rows = board?.rows ?? []
  const searchRows=rows.filter(row=>(!followingOnly||row.isMe||!!row.userId&&follows.ids.includes(row.userId))&&row.displayName.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))).slice(0,20)
  const myIndex = rows.findIndex(row => row.isMe)
  const visibleRows = followingOnly ? rows.filter(row=>row.isMe || (!!row.userId&&follows.ids.includes(row.userId))) : expanded || myIndex < 0 ? rows : rows.filter((_, index) => index < 3 || Math.abs(index - myIndex) <= 2)
  // Accuracy and streak are not in the leaderboard payload today. Returning
  // an empty string keeps the sub-line out of the DOM rather than rendering
  // "0% accurate" for everybody.
  const secondary = (l: PlayLeader): string => {
    const bits: string[] = []
    if (l.accuracy !== null) bits.push(t('leaders.accuracy', { pct: Math.round(l.accuracy) }))
    if (l.streak) bits.push(t('leaders.streak', { n: l.streak }))
    return bits.join(' · ')
  }

  /** Real users can have no display_name; they are anonymous, not invented. */
  const nameOf = (l: PlayLeader) => l.displayName || t('activity.someone')

  return (
    <>
      <div className={`pl-lb-head ${styles.toolbar}`} data-search-open={searchOpen}>

        <div className="pl-per" hidden={searchOpen}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={p === period ? 'pl-on' : undefined}
              aria-pressed={p === period}
              onClick={() => { setExpanded(false); onPeriod(p) }}
            >
              {t(`leaders.${p}`)}
            </button>
          ))}
          <button hidden={searchOpen} type="button" aria-label={t('leaders.history')} title={t('leaders.history')} aria-expanded={history} onClick={()=>{setHistory(!history);onPeriod('week')}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2"/></svg>
          </button>
        </div>
        {searchOpen && <div className={styles.searchBox}>
          <SearchIcon size={18}/>
          <input ref={searchInput} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('leaders.searchPlaceholder')} aria-label={t('leaders.searchPlaceholder')} onKeyDown={e=>{if(e.key==='Escape'){setQuery('');setSearchOpen(false)}}}/>
        </div>}
        <div className={styles.tools}><Press ariaPressed={followingOnly} className={styles.followFilter} ariaLabel={t( followingOnly ? 'leaders.showEveryone' : 'leaders.showFollowing')} size="size-sm" intent={followingOnly?'intent-primary':'intent-ghost'} disabled={!follows.ready} onClick={()=>setFollowingOnly(!followingOnly)}><span className={styles.followFilterContent}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 15a4 4 0 0 1 4 4v2"/></svg>{follows.ready?follows.ids.length:'—'}</span></Press><Press size="size-sm" intent={searchOpen?'intent-primary':'intent-ghost'} ariaLabel={t(searchOpen?'detail.close':'leaders.searchToggle')} ariaPressed={searchOpen} onClick={()=>{setSearchOpen(!searchOpen);setQuery('')}}>{searchOpen ? <span aria-hidden="true">×</span> : <SearchIcon size={18}/>}</Press></div>
      </div>
      {period==='week'&&<div className={styles.weekHistory}>
        <span>{dateLabel(week.labelStart)} – {dateLabel(week.labelEnd)}</span>
        {history&&<div><Press size="size-sm" intent="intent-ghost" disabled={weekOffset>=520} onClick={()=>{setExpanded(false);onWeek?.(weekOffset+1)}} ariaLabel={t('leaders.previousWeek')}>‹</Press>
          <Press size="size-sm" intent="intent-ghost" disabled={weekOffset===0} onClick={()=>{setExpanded(false);onWeek?.(weekOffset-1)}} ariaLabel={t('leaders.nextWeek')}>›</Press>
          {weekOffset>0&&<Press size="size-sm" intent="intent-ghost" onClick={()=>{setExpanded(false);onWeek?.(0)}}>{t('leaders.thisWeek')}</Press>}
        </div>}
      </div>}

      {status === 'loading' && (
        <div style={{ paddingTop: 16 }}>
          <SkeletonList rows={6} height={48} />
        </div>
      )}

      {status === 'error' && (
        <Blank
          icon="warning"
          title={t('error.title')}
          body={t('error.body')}
          action={
            <Press size="size-sm" intent="intent-ghost" onClick={onRetry}>
              {t('error.retry')}
            </Press>
          }
        />
      )}

      {status === 'ready' && rows.length === 0 && !board?.me && (
        <section className={styles.emptyWeek}>
          <strong>{t(period === 'week' ? 'leaders.quietWeekTitle' : 'leaders.empty.title')}</strong>
          <p>{t(period === 'week' ? 'leaders.quietWeekBody' : 'leaders.empty.body')}</p>
          {searchOpen && <p>{t('leaders.searchScope')}</p>}
          <div>
            <Press size="size-sm" onClick={() => onOpenMarkets ? onOpenMarkets() : router.push('/play')}>{t('leaders.exploreMarkets')}</Press>
            {period === 'week' && onWeek && <Press size="size-sm" intent="intent-ghost" disabled={weekOffset >= 520} onClick={() => {setSearchOpen(false);setQuery('');setExpanded(false);onWeek(weekOffset + 1)}}>{t('leaders.previousWeek')}</Press>}
          </div>
        </section>
      )}

      {status === 'ready' && board?.me && <section className={styles.summary} aria-label={t('leaders.summaryTitle')}>
        <div className={styles.summaryHead}>
          <LeaderAvatar leader={board.me} size={40}/>
          <strong>{t('leaders.summaryTitle')}</strong>
          <Press size="size-sm" intent="intent-ghost" onClick={() => router.push('/profile')}>{t('leaders.myProfile')}</Press>
        </div>
        <div className={styles.summaryStats}>
          <div><strong>#{board.me.rank}</strong><span>{t('leaders.yourPosition')}</span></div>
          <div><strong data-loss={board.me.netWinnings < 0}>{formatGuacas(board.me.netWinnings,locale)} <GuacaCoin size={18}/></strong><span>{t('leaders.netWinnings')}</span></div>
          <div><strong>{available == null ? '—' : formatGuacas(available,locale)} <GuacaCoin size={18}/></strong><span>{t('leaders.available')}</span></div>
        </div>
        {board.me.move != null && <Move move={board.me.move}/>}
      </section>}
      {!searchOpen && status === 'ready' && rows.length > 0 && <>
        <div className={styles.scope}><strong>{t('leaders.title')} · {t(`leaders.${period}`)}</strong><RankingInfo weekly={period==='week'}/></div>
        <div className={styles.columns}><span>#</span><span>{t('leaders.player')}</span><span>{t('leaders.netWinnings')}</span></div>
      </>}

      {follows.error&&<p role="alert" className={styles.followError}>{t('leaders.followError')}</p>}
      {!searchOpen&&followingOnly&&status==='ready'&&visibleRows.length===0&&<p className={styles.followEmpty}>{t(follows.ids.length?'leaders.noFollowedResults':'leaders.noFollowing')}</p>}
      {!searchOpen && status === 'ready' && (rows.length > 0 || board?.me) && (
        <div ref={list} className={`pl-lb-list ${styles.list}`} tabIndex={0} role="region" aria-label={t('leaders.standings')}>
          {visibleRows.map((l, k) => (
            <Fragment key={l.userId ?? `r${k}`}>
            {!followingOnly && k > 0 && l.rank > visibleRows[k - 1].rank + 1 && <div className={styles.omitted} aria-hidden="true">···</div>}
            <button type="button" data-podium={l.rank <= 3 ? l.rank : undefined} data-tone={l.rank % 3} ref={l.isMe ? ownRow : undefined} className={`pl-lbr ${styles.row}${l.isMe ? ' pl-me' : ''}`} key={l.userId ?? `r${k}`} onClick={() => setSelected(l)} aria-label={t('leaders.openPlayer', { name: nameOf(l), rank: l.rank })}>
              <div className="pl-r">{l.rank || (k + 1)}</div>
              <LeaderAvatar leader={l} size={28} />
              <div className="pl-who2">
                <div className="pl-n2">{nameOf(l)}{l.isMe && <span className={styles.you}>{t('leaders.you')}</span>}</div>
                {secondary(l) && <div className="pl-s2">{secondary(l)}</div>}
              </div>
              <div className="pl-g2">
                <div className="pl-v2" data-loss={l.netWinnings < 0}>{formatGuacas(l.netWinnings, locale)} <GuacaCoin size={18} /></div>
                <Move move={l.move} />
              </div>
            </button>
            </Fragment>
          ))}
          {!followingOnly && !expanded && visibleRows.length < rows.length && <Press size="size-sm" intent="intent-ghost" block onClick={() => setExpanded(true)}>{t('leaders.seeEveryone')}</Press>}
        </div>
      )}

      {searchOpen&&status==='ready'&&rows.length>0&&<section className={styles.searchResults} aria-label={t('leaders.searchPlayers')}>
       <h2>{t('leaders.searchPlayers')}</h2>
       <p role="status">{query.trim().length<2?t('leaders.searchHint'):t('leaders.searchCount',{count:searchRows.length})}</p>
       {query.trim().length>=2&&searchRows.map(l=><div key={l.userId??l.displayName} className={styles.searchRow}>
        <button type="button" className={styles.searchPerson} onClick={()=>setSelected(l)}>
         <LeaderAvatar leader={l} size={44}/><span><strong>{nameOf(l)}</strong><small>{secondary(l)||t('leaders.player')}{l.isMe?` · ${t('leaders.you')}`:''}</small></span>
        </button>
        {!l.isMe&&!l.isSimulation&&l.userId&&<Press size="size-sm" intent={follows.ids.includes(l.userId)?'intent-ghost':'intent-primary'} disabled={follows.busy||!follows.ready} onClick={()=>void follows.toggle(l.userId!)}>{t(follows.ids.includes(l.userId)?'leaders.followed':'leaders.follow')}</Press>}
       </div>)}
      </section>}
      {selected && <PlayerPreview follows={follows} leader={selected} name={nameOf(selected)} period={period} onClose={() => setSelected(null)} onProfile={() => router.push('/profile')} />}

    </>
  )
}

function PlayerPreview({ follows, leader, name, period, onClose, onProfile }: {
  follows: ReturnType<typeof useMemberFollows>; leader: PlayLeader; name: string; period: LeaderPeriod; onClose: () => void; onProfile: () => void
}) {
  const t = useTranslations('play')
  const locale = useLocale()
  const rateText = useTranslations('predictionRate')
  const [counts,setCounts]=useState<{followers:number;following:number}|null>(null)
  const [countVersion,setCountVersion]=useState(0)
  useEffect(()=>{
    if(!leader.userId||leader.isSimulation)return
    let current=true
    fetch(`/api/play/follows?userId=${encodeURIComponent(leader.userId)}`,{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(current)setCounts(d)}).catch(()=>{if(current)setCounts(null)})
    return()=>{current=false}
  },[leader.userId,leader.isSimulation,countVersion])
  const followed=!!leader.userId&&follows.ids.includes(leader.userId)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement as HTMLElement | null
    element?.showModal()
    return () => { element?.close(); previous?.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={dialog} className={`pl-trade-dialog pl-amount-dialog ${styles.preview}`} aria-labelledby="leader-player-title" onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="pl-trade-content">
      <div className="pl-sheet-head"><h2 id="leader-player-title">{name}</h2>
      {!leader.isMe&&!leader.isSimulation&&leader.userId&&<Press size="size-sm" intent={followed?'intent-primary':'intent-ghost'} disabled={follows.busy||!follows.ready} onClick={async()=>{if(await follows.toggle(leader.userId!))setCountVersion(n=>n+1)}}>{t(followed?'leaders.followed':'leaders.follow')}</Press>}
      <button className="pl-x" onClick={onClose} aria-label={t('detail.close')}>×</button></div>
      <div className={styles.playerHero}>{leader.isSimulation ? <div className={styles.figure}><PlayerFigure outfit={simulationPlayerLook(leader.avatarSeed || leader.displayName)} wardrobe={simulationPlayerWardrobe(leader.avatarSeed || leader.displayName)} approvedArtwork /></div> : leader.userId ? <MemberAvatar userId={leader.userId} full fallback={<LeaderAvatar leader={leader} size={112}/>}/> : <LeaderAvatar leader={leader} size={112} />}<span>{leader.isMe ? t('leaders.you') : t('leaders.player')}</span></div>
      {follows.error&&<p role="alert" className={styles.followError}>{t('leaders.followError')}</p>}
      {!leader.isSimulation&&<div className={styles.socialCounts}><div><strong>{counts?.followers??'—'}</strong><span>{t('leaders.followers')}</span></div><div><strong>{counts?.following??'—'}</strong><span>{t('leaders.following')}</span></div></div>}
      <div className={styles.stats}><div><span>{t(`leaders.${period}`)}</span><strong>#{leader.rank}</strong></div>{!leader.isSimulation && leader.userId && <div className={styles.accuracy}><span>{rateText('shortLabel')}</span><PredictionRate userId={leader.userId} metric/></div>}<div><span>{t('leaders.netWinnings')}</span><strong data-loss={leader.netWinnings < 0}>{formatGuacas(leader.netWinnings, locale)} <GuacaCoin size={24} /></strong></div></div>
      {leader.isMe && <Press onClick={onProfile}>{t('leaders.myProfile')} ↗</Press>}
    </div>
  </dialog>
}
