'use client'
import MatchLink from './MatchLink'
import EditorialMarketHero, { EditorialEstimate } from './EditorialMarketHero'
// src/app/[locale]/(app)/play/_components/MarketDetailSheet.tsx
//
// The fuller picture, behind a tap on the card. Head-to-head, career numbers
// and the crowd-vs-model split live here rather than on the card because the
// deck is a swipe surface: a card that takes eight numbers to read is a card
// nobody swipes.
//
// Everything is conditional on the data existing. `players.titles`,
// `win_rate` and `total_matches` are genuinely NULL for real players (Agueda
// Perez, for one), so each row is omitted rather than printed as 0 — "0 titles"
// and "we don't know" are different claims and only one of them is true.
//
// Head-to-head is derived from `matches`, not stored, and ZERO meetings is the
// common case — "they have never met" is the normal answer here, not an error.

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { PairIdentity, type PairAccent } from './PlayerIdentity'
import { previewBuy } from './market-preview'
import { Press, toPct } from './shared'
import type { PlayMarket, PlayPlayer, Side } from './types'

/** "Rufo / Castello" from the resolved players, or '' if none resolved. */
function pairNames(players: PlayPlayer[]): string {
  return players.map((p) => p.surname).filter(Boolean).join(' / ')
}

function PlayerStats({ player }: { player: PlayPlayer }) {
  const t = useTranslations('play')
  const stats: string[] = []
  if (player.ranking !== null) stats.push(t('detail.rank', { n: player.ranking }))
  if (player.raceRanking !== null) stats.push(t('detail.race', { n: player.raceRanking }))
  if (player.titles !== null) stats.push(t('detail.titles', { n: player.titles }))
  // A win rate without its sample size is a number without a denominator; when
  // total_matches is missing the percentage goes out on its own rather than
  // borrowing a count from somewhere else.
  if (player.winRate !== null) {
    stats.push(
      player.totalMatches !== null
        ? t('detail.winRateOf', { pct: player.winRate, n: player.totalMatches })
        : t('detail.winRate', { pct: player.winRate }),
    )
  }

  return (
    <div className="pl-dplayer">
      <div className="pl-dname">{player.name}</div>
      {stats.length > 0 && (
        <div className="pl-dstats">
          {stats.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      )}
      {player.form && (
        <div className="pl-dform">
          {t('detail.formLast', { of: player.form.of })}
          <span className="pl-dstreak">
            {/* Oldest → newest reads the way a form guide is drawn, so the
                newest-first string from the API is reversed for display. */}
            {[...player.form.streak].reverse().map((mark, i) => (
              <i key={i} className={mark === 'W' ? 'pl-w' : 'pl-l'}>
                {mark === 'W' ? t('detail.win') : t('detail.loss')}
              </i>
            ))}
          </span>
        </div>
      )}
      {player.form === null && stats.length === 0 && (
        <div className="pl-dstats pl-dnone">{t('detail.noStats')}</div>
      )}
    </div>
  )
}

/**
 * `accent` rather than a slot number: the sheet is opened from the card and
 * has to wear the same two colours, and on the card orange means "the pair the
 * question is about", not "pair one".
 */
function PairBlock({ players, accent }: { players: PlayPlayer[]; accent: PairAccent }) {
  const label = pairNames(players)
  return (
    <div className="pl-dpair">
      <div className="pl-dpair-head">
        <span className={`pl-dside pl-${accent}`}>{label}</span>
      </div>
      <PairIdentity players={players} accent={accent} size={40} />
      {players.map((p, i) => (
        <PlayerStats key={p.id ?? `${p.name}-${i}`} player={p} />
      ))}
    </div>
  )
}

export interface MarketDetailSheetProps {
  market: PlayMarket
  onChoose: (side: Side) => void
  onClose: () => void
}

export default function MarketDetailSheet({ market, onClose, onChoose }: MarketDetailSheetProps) {
  const t = useTranslations('play')
  const locale = useLocale()
  const odds = (side: Side) => {
    const quote = previewBuy(market, side, 1)
    return quote ? `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(quote.shares / quote.cost)}×` : '—'
  }

  const dialog = useRef<HTMLDialogElement>(null)
  const [closing, setClosing] = useState(false)
  const requestClose = () => {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onClose()
    else setClosing(true)
  }
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement as HTMLElement | null
    element?.showModal()
    return () => { element?.close(); previous?.focus() }
  }, [])

  const players = market.editorial ? null : market.players
  const h2h = market.editorial ? null : market.h2h
  const crowd = toPct(market.priceYes)
  // Exactly one of these is ever non-null. A set-shape market ("will any set
  // finish 6-0") has no model prediction — the Elo model only predicts who
  // wins — so it shows the measured historical rate instead, in a deliberately
  // different visual register. Dressing an average as a prediction is the one
  // thing this block must not do.
  const model = market.modelProb !== null ? toPct(market.modelProb) : null
  const baseline = market.baselineProb !== null ? toPct(market.baselineProb) : null

  return (
    <dialog ref={dialog} className={`pl-trade-dialog pl-amount-dialog pl-details-dialog${closing ? ' pl-closing' : ''}`} aria-label={t('detail.title')}
      onAnimationEnd={e => { if (closing && e.target === e.currentTarget) onClose() }}
      onCancel={e => { e.preventDefault(); requestClose() }}>
      <div className="pl-trade-content pl-detail">
        <MatchLink matchId={market.matchId} live={market.live}/>
        <div className="pl-sheet-head">
          <div>
            <h3>{t('detail.title')}</h3>
            <p>{market.question}</p>
          </div>
          <button type="button" className="pl-x" onClick={requestClose} aria-label={t('detail.close')}>
            ✕
          </button>
        </div>

        {market.editorial && <><EditorialMarketHero data={market.editorial} /><EditorialEstimate data={market.editorial} /></>}
        {market.rules && <p style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{market.rules}</p>}

        {players && (
          <div className="pl-dpairs">
            <PairBlock
              players={players.pair1}
              accent={market.subjectPair === 1 ? 'subject' : 'other'}
            />
            <PairBlock
              players={players.pair2}
              accent={market.subjectPair === 2 ? 'subject' : 'other'}
            />
          </div>
        )}

        {h2h && (
          <div className="pl-dsec">
            <div className="pl-dk">{t('detail.headToHead')}</div>
            {h2h.pair1Wins === 0 && h2h.pair2Wins === 0 ? (
              <p className="pl-dempty">{t('detail.neverMet')}</p>
            ) : (
              <div className="pl-dh2h">
                <span className="pl-dh2h-side">
                  <b>{h2h.pair1Wins}</b>
                  {players && <em>{pairNames(players.pair1)}</em>}
                </span>
                <span className="pl-dh2h-dash">–</span>
                <span className="pl-dh2h-side">
                  <b>{h2h.pair2Wins}</b>
                  {players && <em>{pairNames(players.pair2)}</em>}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="pl-dsec">
          <div className="pl-dk">
            {market.editorial ? t('deck.crowdPrice') : model === null && baseline !== null
              ? t('detail.crowdVsBaseline')
              : t('detail.crowdVsModel')}
          </div>
          <div className="pl-dsplit">
            <div>
              <span>{t('deck.crowdPrice')}</span>
              <b>{crowd}%</b>
            </div>
            {model !== null ? (
              <div>
                <span>{t('deck.ourModel')}</span>
                <b className="pl-dmodel">{model}%</b>
              </div>
            ) : baseline !== null ? (
              <div>
                <span>{t('detail.baseRate')}</span>
                <b className="pl-dbaseline">{t('deck.historicalPct', { pct: baseline })}</b>
              </div>
            ) : null}
          </div>
          <p className="pl-dnote">
            {model === null && baseline !== null
              ? t('detail.baseRateNote')
              : t('detail.yesNote')}
          </p>
        </div>
      </div>
      <div className="pl-detail-choice-footer">
        <div className="pl-odds pl-pair-choices">
          {(players && market.subjectPair === 2 ? ['no', 'yes'] as const : ['yes', 'no'] as const).map((side, index) => <div className="pl-detail-choice" key={side}>
            {players && <span className="pl-choice-pair">{pairNames(index === 0 ? players.pair1 : players.pair2)}</span>}
            <Press className={`pl-choice-press pl-${side}`} size="size-lg" intent="intent-neutral" disabled={closing}
              onClick={() => onChoose(side)} ariaLabel={`${t(`deck.${side}`)} · ${odds(side)}`}>
              <span className="pl-lbl">{t(`deck.${side}`)}</span><span className="pl-pct">{odds(side)}</span>
            </Press>
          </div>)}
        </div>
      </div>
    </dialog>
  )
}
