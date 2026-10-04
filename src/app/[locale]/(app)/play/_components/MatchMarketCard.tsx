'use client'

import { useEffect, useId, useState } from 'react'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import { VersusIdentity } from './PlayerIdentity'
import PositionNudge from './PositionNudge'
import MatchLink from './MatchLink'
import VolumeTicker from './VolumeTicker'
import { previewBuy } from './market-preview'
import type { PlayMarket, PlayPosition, Side } from './types'
import styles from './MatchMarketCard.module.css'

export default function MatchMarketCard({ markets, positions, onChoose, onDetail, onViewPositions }: {
  markets: PlayMarket[]; positions: PlayPosition[]
  onChoose: (market: PlayMarket, side: Side) => void
  onDetail: (market: PlayMarket) => void
  onViewPositions: () => void
}) {
  const t = useTranslations('play')
  const locale = useLocale()
  const id = useId()
  const [timeZone, setTimeZone] = useState<string | null>(null)
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    try {
      const cookie = document.cookie.split('; ').find(value => value.startsWith('geo-timezone='))
      const zone = cookie ? decodeURIComponent(cookie.slice('geo-timezone='.length)) : browserZone
      new Intl.DateTimeFormat(locale, { timeZone: zone }).format()
      setTimeZone(zone)
    } catch { setTimeZone(browserZone) }
  }, [locale])
  const match = markets.find(m => m.players) ?? markets[0]
  const orderedMarkets = [...markets].sort((a, b) => Number(b.resolverKey === 'match.winner_is_pair') - Number(a.resolverKey === 'match.winner_is_pair'))
  const shortTournament = match.competition?.replace(/^CUPRA\s+/i, '').replace(/\s+PREMIER PADEL\b/ig, '').trim()
  const round = match.roundLabel?.replace(/^quarter[ -]?finals?$/i, 'QF').replace(/^semi[ -]?finals?$/i, 'SF').replace(/^final$/i, 'F').replace(/^round of (\d+)$/i, 'R$1')
  const start = match.startsAt ? new Date(match.startsAt) : null
  const startLabel = start && timeZone && Number.isFinite(start.getTime()) ? new Intl.DateTimeFormat(locale, {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false, timeZone}).format(start) : null
  const live = markets.some(m => m.live)
  const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return <article className={styles.card} aria-label={match.subtitle || match.question}>
      <Image src="/play/background-compare/outdoor.png" alt="" fill sizes="(max-width: 500px) 100vw, 420px" className={styles.background}/>
    <header className={styles.header}>
    <div className={styles.chips}>
      {live && <span className={styles.live}>{t('live')}</span>}
      {[shortTournament, match.categoryLabel, round].filter(Boolean).map((label, i) => <span key={i}>{label}</span>)}
      {!match.competition && !match.categoryLabel && !match.roundLabel && match.context && <span>{match.context}</span>}
    </div>
    <MatchLink matchId={match.matchId} live={live} iconOnly/>
    </header>
    {!live && startLabel && <time className={styles.schedule} dateTime={match.startsAt!}>{t('deck.scheduledTime', {time: startLabel})}</time>}
    <div className={styles.hero}>
      {match.players ? <VersusIdentity pair1={match.players.pair1} pair2={match.players.pair2} subjectPair={1} vsLabel={t('deck.vs')} center={live && match.liveScore ? <span className={styles.liveScore}><strong>{match.liveScore.pair1}–{match.liveScore.pair2}</strong><small>{t('matchNavigation.set', {number:match.liveScore.set})}</small></span> : undefined}/> : <h2>{match.subtitle}</h2>}
    </div>
    <div className={styles.questions}>
      {orderedMarkets.map((market, index) => {
        const held = positions.filter(p => p.marketId === market.id && p.shares > 0)
        const winner = market.resolverKey === 'match.winner_is_pair'
        const secondary = market.resolverKey === 'match.went_to_three_sets'
        const heading = `${id}-${index}`
        return <section className={styles.question} data-secondary={secondary || undefined} key={market.id} aria-labelledby={heading}>
          <div className={styles.questionHeading}>
          <h2 id={heading}>{market.question}</h2>
          <button className={styles.details} type="button" onClick={() => onDetail(market)} aria-label={`${t('detail.openShort')} · ${market.question}`}>{t('detail.openShort')}</button>
          </div>
          <PositionNudge positions={held} onOpen={onViewPositions}/>
          {held.length === 0 && <div className={styles.choices}>
            {(['yes', 'no'] as const).map(side => {
              const quote = previewBuy(market, side, 1)
              const odds = quote ? `${formatter.format(quote.shares / quote.cost)}×` : '—'
              const pair = side === 'yes' ? market.subjectPair : market.subjectPair === 1 ? 2 : 1
              const preset = (winner ? pair === 1 : side === 'yes') ? PRESS_PRESETS.chunkyTeamOrange : PRESS_PRESETS.chunkyTilted
              return <PressButton {...preset} depth={secondary ? 4 : 5} key={side} type="button" className={styles.choice}
                data-team={winner ? pair : undefined} data-side={side} disabled={!quote}
                aria-label={`${t(`deck.${side}`)} · ${market.question} · ${odds}`}
                onClick={() => onChoose(market, side)}>
                <strong>{t(`deck.${side}`)}</strong><small>{odds}</small>
              </PressButton>
            })}
          </div>}
        </section>
      })}
    </div>
    <VolumeTicker key={match.matchId ?? match.id} className={styles.volume} volume={match.matchVolumeGuacas ?? markets.reduce((sum, market) => sum + market.volumeGuacas, 0)}/>
  </article>
}
