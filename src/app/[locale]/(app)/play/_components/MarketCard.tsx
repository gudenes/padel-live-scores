'use client'
// src/app/[locale]/(app)/play/_components/MarketCard.tsx
//
// The contents of one deck card: hero art, question, crowd-vs-model
// sparkline, the YES/NO price blocks and the drag stamps.
//
// Rendered INSIDE the `.pl-mcard` element that SwipeDeck owns — the card
// shell is the thing being dragged, so its transform must not be re-applied
// by a React render of this subtree.

import { useLocale, useTranslations } from 'next-intl'
import { HeroArt, Sparkline } from './art'
import { VersusIdentity } from './PlayerIdentity'
import { formatGuacas, toPct } from './shared'
import type { PlayMarket, PlayPlayer } from './types'

/**
 * The API sends `subtitle` as plain text ("Coello / Tapia vs Galán /
 * Chingotto"). The design emphasises the "vs"; rather than accept HTML from
 * an endpoint we split on the standalone token and bold it ourselves.
 */
function Subtitle({ text }: { text: string }) {
  // The capture group keeps the surrounding spaces inside the emphasised
  // chunk — splitting on \s(vs)\s would swallow them and render
  // "Coello / TapiavsGalán / Chingotto".
  const parts = text.split(/(\svs\.?\s)/i)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        /^\svs\.?\s$/i.test(part) ? <b key={i}>{part}</b> : <span key={i}>{part}</span>,
      )}
    </>
  )
}

/**
 * `stateLabel` is free text from the API. Today /api/play/markets emits two
 * fixed ENGLISH strings ('Live now', 'Starting soon'), so they are mapped
 * back to translation keys here — a Spanish user must not get an English
 * sentence on the card. Anything unrecognised is rendered verbatim, and a
 * trailing score gets the lime accent the design calls for ("Set 1 · 4–4").
 */
const STATE_KEYS: Record<string, string> = {
  'live now': 'deck.stateLiveNow',
  'starting soon': 'deck.stateStartingSoon',
}

function StateLabel({ text }: { text: string }) {
  const t = useTranslations('play')
  const key = STATE_KEYS[text.trim().toLowerCase()]
  if (key) return <>{t(key)}</>

  const parts = text.split('·')
  const tail = parts[parts.length - 1]?.trim() ?? ''
  if (parts.length < 2 || !/^\d+\s*[–—-]\s*\d+$/.test(tail)) return <>{text}</>
  return (
    <>
      {parts.slice(0, -1).join('·')}·{' '}
      <em style={{ fontStyle: 'normal', color: 'var(--lime)' }}>{tail}</em>
    </>
  )
}

/**
 * The one form line the card has room for: the most decisive record among the
 * four players.
 *
 * "Decisive" is the margin between wins and losses in the sample — a 4-1 says
 * something, a 3-2 says almost nothing. Ties break toward the larger sample and
 * then the better ranking, so the choice is deterministic and does not flicker
 * between renders of the same market.
 */
type PlayerWithForm = PlayPlayer & { form: NonNullable<PlayPlayer['form']> }

export function pickFormPlayer(market: PlayMarket): PlayerWithForm | null {
  const candidates = [
    ...(market.players?.pair1 ?? []),
    ...(market.players?.pair2 ?? []),
  ].filter((p): p is PlayerWithForm => p.form !== null)
  if (candidates.length === 0) return null

  // Sorted descending on (margin, sample size, ranking). `sort` is stable in
  // every engine we ship to, so a full three-way tie keeps slot order.
  const better = (a: PlayerWithForm, b: PlayerWithForm): number => {
    const margin = (p: PlayerWithForm) => Math.abs(p.form.wins * 2 - p.form.of)
    if (margin(a) !== margin(b)) return margin(b) - margin(a)
    if (a.form.of !== b.form.of) return b.form.of - a.form.of
    // Ranking is nullable; an unranked player never outranks a ranked one.
    return (a.ranking ?? Number.POSITIVE_INFINITY) - (b.ranking ?? Number.POSITIVE_INFINITY)
  }
  return [...candidates].sort(better)[0]!
}

export interface MarketCardProps {
  market: PlayMarket
  /** Opens the detail sheet. Absent on the cards stacked behind the top one. */
  onDetail?: (market: PlayMarket) => void
}

export default function MarketCard({ market, onDetail }: MarketCardProps) {
  const t = useTranslations('play')
  const locale = useLocale()

  const yesPct = toPct(market.priceYes)
  const horizonClass =
    market.horizon === 'season' ? ' pl-season' : market.horizon === 'tourn' ? ' pl-tourn' : ''

  const players = market.players
  const formPlayer = pickFormPlayer(market)

  return (
    <>
      <div className="pl-hero">
        <HeroArt tone={market.horizon} idSeed={market.id} />
        {players ? (
          // The four faces sit ON the procedural court art, which stays as the
          // backdrop — it is the established look and we still have no
          // photography licence for a full-bleed hero image.
          <VersusIdentity
            pair1={players.pair1}
            pair2={players.pair2}
            vsLabel={t('deck.vs')}
            subjectPair={market.subjectPair}
          />
        ) : (
          // Tournament- and season-horizon markets have no match and therefore
          // no four players; they keep the ghosted monogram.
          <div className="pl-mono" aria-hidden>
            <i>{market.monogram.a}</i>
            {market.monogram.b && (
              <>
                <s>vs</s>
                <i>{market.monogram.b}</i>
              </>
            )}
          </div>
        )}
        <div className="pl-chips">
          {market.live && (
            <span className="pl-tag pl-live">
              <span className="pl-dot" />
              {t('live')}
            </span>
          )}
          <span className={`pl-tag pl-horizon${horizonClass}`}>
            {t(`horizon.${market.horizon}`)}
          </span>
          {market.context && <span className="pl-tag pl-ctx">{market.context}</span>}
        </div>
      </div>

      <div className="pl-mbody">
        <h2 className="pl-q">{market.question}</h2>
        {/* The hero already names both pairs, with a flag and a ranking each,
            so repeating "Rufo / Castello vs Perez / Fassio" here would spend
            the room the form line needs. The subtitle stays for the markets
            that have no players to show. */}
        {!players && market.subtitle && (
          <p className="pl-sub">
            <Subtitle text={market.subtitle} />
          </p>
        )}
        {market.stateLabel && (
          <div className="pl-state">
            <StateLabel text={market.stateLabel} />
          </div>
        )}

        {(formPlayer?.form || onDetail) && (
          <div className="pl-form">
            {formPlayer?.form ? (
              <span className="pl-formline">
                {t('deck.formLine', {
                  name: formPlayer.surname,
                  wins: formPlayer.form.wins,
                  of: formPlayer.form.of,
                })}
              </span>
            ) : (
              <span />
            )}
            {onDetail && (
              // A real focusable button so the sheet is reachable without a
              // pointer. The tap-anywhere gesture in DeckScreen covers touch;
              // both paths land on the same handler, so firing both is a no-op.
              <button
                type="button"
                className="pl-more"
                onClick={() => onDetail(market)}
                aria-label={t('detail.open')}
              >
                {t('detail.openShort')}
              </button>
            )}
          </div>
        )}

        <div className="pl-spark">
          <div className="pl-lg">
            <span className="pl-k2">
              <i />
              {t('deck.crowdPrice')}
            </span>
            <span className="pl-k2">
              <i className="pl-dash" />
              {t('deck.ourModel')}
            </span>
          </div>
          <Sparkline
            crowd={market.priceYes}
            model={market.modelProb}
            history={market.history}
            idSeed={market.id}
          />
        </div>

        <div className="pl-odds">
          <div className="pl-odd pl-yes">
            <div className="pl-lbl">{t('deck.yes')}</div>
            <div className="pl-pct">{yesPct}%</div>
          </div>
          <div className="pl-odd pl-no">
            <div className="pl-lbl">{t('deck.no')}</div>
            {/* YES and NO always sum to 100 — a play-money market has no
                house cut, so anything else reads as broken arithmetic. */}
            <div className="pl-pct">{100 - yesPct}%</div>
          </div>
        </div>

        <div className="pl-model">
          <span className="pl-ai">{t('deck.aiPct', { pct: toPct(market.modelProb) })}</span>
          <span>
            {market.volumeGuacas > 0
              ? t('deck.volumeTraded', { amount: formatGuacas(market.volumeGuacas, locale) })
              : t('deck.noTradesYet')}
          </span>
        </div>
      </div>

      <div className="pl-stamp pl-s-yes">{t('deck.yes')}</div>
      <div className="pl-stamp pl-s-no">{t('deck.no')}</div>
    </>
  )
}
