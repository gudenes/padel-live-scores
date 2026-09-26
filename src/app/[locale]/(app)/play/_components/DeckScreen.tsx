'use client'
// src/app/[locale]/(app)/play/_components/DeckScreen.tsx
//
// The market deck. Two gestures, deliberately on different axes:
//
//   VERTICAL DRAG  moves between markets. Nothing is committed; this is
//                  browsing, the same axis a feed scrolls on.
//   YES / NO       the two round buttons (and ArrowLeft/ArrowRight). This is
//                  the only way to take a side.
//
// The original port committed a side on a HORIZONTAL drag, Tinder-style. That
// is gone. It cannot coexist with a vertical browse gesture — every diagonal
// flick becomes a coin toss between "next market" and "500 guacas on yes", and
// of the two only one is reversible. The buttons were already the committed
// interaction; now they are the only one.
//
// All drag work mutates the card's style directly rather than going through
// React state. A setState per pointermove would re-render the whole card
// subtree sixty times a second; the transform is a presentational detail that
// React has no reason to own.
//
// The resting transforms are applied in a layout effect rather than in JSX for
// the same reason: if React held `transform` as a prop it would clobber an
// in-progress drag on any unrelated parent re-render.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import MarketCard from './MarketCard'
import { Press } from './shared'
import type { PlayMarket, Side } from './types'

// Depth 0 is the card being read; depth 1 peeks out below it. cardRefs is
// keyed by DEPTH rather than by render position, so "the top card" is always
// cardRefs.current[TOP] whether or not the peek card exists.
const TOP = 0
const PEEK = 1

// The seam between the two cards. The peek card rests one card-height plus
// this gap down the deck, so the visible strip is (--pl-peek - PEEK_GAP_PX)
// — keep the two in step with styles.ts.
const PEEK_GAP_PX = 10
const PEEK_SCALE = 0.965
// The peek card trails the drag instead of matching it. Moving in lockstep
// reads as one tall sheet sliding past, not as two stacked cards.
const PEEK_FOLLOW = 0.4

// Vertical travel that commits a move to the next / previous market.
const NAV_COMMIT_PX = 64
// How far the outgoing card travels. Taller than any phone so it is genuinely
// gone rather than parked just off the deck's clipped edge.
const NAV_FLY_PX = 620
// Must match .pl-mcard.pl-nav's transition duration in styles.ts: the deck
// remounts when this elapses, and a remount mid-transition snaps.
const NAV_MS = 240
// Resistance for a drag with nowhere to go — down-swipe on the first market.
// It still moves, because a dead card reads as a broken one.
const RUBBER = 0.3

// How long the YES / NO stamp shows before the trade sheet takes over. The
// card does NOT fly away on a commit: the trade is not done yet, and closing
// the sheet has to return the user to the card they were looking at.
const STAMP_MS = 160

// A tap, as distinct from a drag that changed its mind: the pointer travelled
// almost nowhere and was down briefly. Deliberately far below NAV_COMMIT_PX —
// a 40px drag that snaps back is an aborted swipe, not a request to read more.
const TAP_PX = 9
const TAP_MS = 450

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Where a card sits, optionally offset by an in-progress drag.
 *
 * The peek card's offset is expressed as a percentage of its OWN height, which
 * is the deck minus the peek strip — so nothing here has to measure the DOM,
 * and the resting pose stays correct through a viewport resize without a
 * relayout pass of our own.
 */
function restingTransform(depth: number, dy = 0): string {
  if (depth === TOP) return `translateY(${dy}px)`
  const offset = PEEK_GAP_PX + dy * PEEK_FOLLOW
  return `translateY(calc(100% + ${offset}px)) scale(${PEEK_SCALE})`
}

function restingOpacity(depth: number): string {
  return depth === TOP ? '1' : '.55'
}

export interface DeckScreenProps {
  markets: PlayMarket[]
  /** Index of the top card. Owned by the page so a completed trade advances it. */
  index: number
  onCommit: (market: PlayMarket, side: Side) => void
  /**
   * Move between markets. +1 is the next market, -1 the previous. Never
   * commits a side. The page owns the index and is responsible for clamping —
   * this component only ever reports the direction of the gesture.
   */
  onNavigate: (delta: 1 | -1) => void
  /**
   * Tap on the card body — opens the detail sheet. Never advances the deck and
   * never commits a side.
   */
  onDetail: (market: PlayMarket) => void
  /** Whether the deck screen is the one on display — gates the keyboard shortcuts. */
  active: boolean
}

export default function DeckScreen({
  markets,
  index,
  onCommit,
  onNavigate,
  onDetail,
  active,
}: DeckScreenProps) {
  const t = useTranslations('play')
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
  // A card is mid-flight; ignore further input until it lands.
  const busyRef = useRef(false)
  // Kept in refs so the pointer handlers, which are attached once per card,
  // always call the current callback without re-attaching. Assigned in an
  // effect rather than during render — the handlers only read them later, from
  // a user gesture.
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  }, [onCommit])
  const navigateRef = useRef(onNavigate)
  useEffect(() => {
    navigateRef.current = onNavigate
  }, [onNavigate])
  const detailRef = useRef(onDetail)
  useEffect(() => {
    detailRef.current = onDetail
  }, [onDetail])

  // Reset every card to its resting pose whenever the deck advances.
  useLayoutEffect(() => {
    busyRef.current = false
    for (const depth of [TOP, PEEK]) {
      const el = cardRefs.current[depth]
      if (!el) continue
      el.classList.remove('pl-anim', 'pl-nav')
      el.style.transform = restingTransform(depth)
      el.style.opacity = restingOpacity(depth)
      el.querySelectorAll<HTMLElement>('.pl-stamp').forEach((s) => {
        s.style.opacity = '0'
      })
    }
  }, [index, markets])

  /**
   * Take a side. Flashes the stamp and hands off to the trade sheet.
   *
   * The card stays where it is. It used to fly off-screen here, which was
   * wrong in a way that only showed on cancel: the reset layout effect keys on
   * [index, markets], and cancelling a trade changes neither, so the card was
   * never restored and the user came back to an empty deck. The deck only
   * advances once the trade actually lands, via the page's advance().
   */
  const commit = useCallback((el: HTMLDivElement, market: PlayMarket, side: Side) => {
    busyRef.current = true
    const stamp = el.querySelector<HTMLElement>(side === 'yes' ? '.pl-s-yes' : '.pl-s-no')
    if (stamp) stamp.style.opacity = '1'
    const delay = prefersReducedMotion() ? 0 : STAMP_MS
    window.setTimeout(() => {
      busyRef.current = false
      // Cleared before the handoff — by now the trade sheet covers the card,
      // so this is invisible, and it is the only chance to clean up before a
      // cancelled trade returns to this same node at this same index.
      if (stamp) stamp.style.opacity = '0'
      commitRef.current(market, side)
    }, delay)
  }, [])

  /** Move to the next (+1) or previous (-1) market, animating in that direction. */
  const navigate = useCallback((delta: 1 | -1) => {
    const el = cardRefs.current[TOP]
    if (!el) return
    busyRef.current = true
    const reduced = prefersReducedMotion()
    if (!reduced) {
      el.classList.add('pl-nav')
      // Next means the card you were reading leaves upward, matching the
      // swipe-up that asked for it.
      el.style.transform = `translateY(${-delta * NAV_FLY_PX}px)`
      el.style.opacity = '0'
      // The peek card rises into the vacated slot. It is about to be replaced
      // by a freshly-keyed node at the same position, so the two motions meet.
      const peek = cardRefs.current[PEEK]
      if (peek && delta === 1) {
        peek.classList.add('pl-nav')
        peek.style.transform = restingTransform(TOP)
        peek.style.opacity = '1'
      }
    }
    window.setTimeout(() => {
      busyRef.current = false
      navigateRef.current(delta)
    }, reduced ? 0 : NAV_MS)
  }, [])

  /** Programmatic side-take — the round buttons and ArrowLeft / ArrowRight. */
  const swipe = useCallback(
    (side: Side) => {
      if (busyRef.current || markets.length === 0) return
      const el = cardRefs.current[TOP]
      const market = markets[index % markets.length]
      if (!el || !market) return
      commit(el, market, side)
    },
    [commit, index, markets],
  )

  // Vertical drag, attached to the top card only.
  useEffect(() => {
    const el = cardRefs.current[TOP]
    if (!el || markets.length === 0) return
    const market = markets[index % markets.length]
    if (!market) return

    // There is no market before the first one. A down-drag here is allowed to
    // move, under resistance, and always snaps back.
    const canPrev = index > 0
    // With a single market in the deck there is nothing to page to at all.
    const canNext = markets.length > 1

    let startX = 0
    let startY = 0
    let dx = 0
    let dy = 0
    let dragging = false
    let pointerId: number | null = null
    let downAt = 0

    /** The distance the card actually moves, after edge resistance. */
    const resisted = (raw: number): number => {
      if (raw > 0 && !canPrev) return raw * RUBBER
      if (raw < 0 && !canNext) return raw * RUBBER
      return raw
    }

    const paint = () => {
      const moved = resisted(dy)
      el.style.transform = restingTransform(TOP, moved)
      const peek = cardRefs.current[PEEK]
      if (peek) peek.style.transform = restingTransform(PEEK, moved)
    }

    const settle = () => {
      el.classList.add('pl-anim')
      el.style.transform = restingTransform(TOP)
      const peek = cardRefs.current[PEEK]
      if (peek) {
        peek.classList.add('pl-anim')
        peek.style.transform = restingTransform(PEEK)
      }
    }

    const onDown = (e: PointerEvent) => {
      if (busyRef.current) return
      dragging = true
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      downAt = e.timeStamp
      dx = 0
      dy = 0
      el.setPointerCapture(pointerId)
      el.classList.remove('pl-anim', 'pl-nav')
    }

    const onMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return
      dx = e.clientX - startX
      dy = e.clientY - startY
      paint()
    }

    const onEnd = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return
      dragging = false
      if (pointerId !== null) {
        try {
          el.releasePointerCapture(pointerId)
        } catch {
          // The pointer may already have been released by the browser.
        }
      }

      // Up is negative in client coordinates, and swiping up asks for the
      // next market — the same direction as every vertical feed. The raw dy
      // is tested, not the resisted one: an edge drag must never commit, and
      // resistance only scales the distance, it does not cap it.
      if (dy <= -NAV_COMMIT_PX && canNext) {
        navigate(1)
      } else if (dy >= NAV_COMMIT_PX && canPrev) {
        navigate(-1)
      } else {
        settle()
        // A tap, not an aborted drag: open the detail sheet. The card is left
        // exactly as it was — no navigation, no side taken. `setPointerCapture`
        // above retargets the subsequent `click`, so the button inside the card
        // cannot be relied on for touch; this is the gesture that works.
        const still = Math.abs(dx) <= TAP_PX && Math.abs(dy) <= TAP_PX
        if (still && e.timeStamp - downAt <= TAP_MS) {
          detailRef.current(market)
        }
      }
      dx = 0
      dy = 0
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onEnd)
    el.addEventListener('pointercancel', onEnd)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onEnd)
      el.removeEventListener('pointercancel', onEnd)
    }
  }, [navigate, index, markets])

  // Keyboard parity for both gestures, only while the deck is the visible
  // screen: Down / Up browse, Right / Left take a side like the two buttons.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      // The detail sheet is a modal <dialog> that leaves `screen` on 'deck',
      // so `active` alone does not tell us it is open. Paging the deck behind
      // it would leave the sheet describing a market that is no longer shown.
      if (document.querySelector('dialog[open]')) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (!busyRef.current && markets.length > 1) navigate(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (!busyRef.current && index > 0) navigate(-1)
      } else if (e.key === 'ArrowRight') swipe('yes')
      else if (e.key === 'ArrowLeft') swipe('no')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, swipe, navigate, index, markets])

  // Back-to-front, so the top card is last in the DOM and paints over the peek
  // without a z-index ladder. A one-market deck has nothing to peek at, and
  // showing the same card twice would promise a depth the deck does not have.
  const depths = markets.length > 1 ? [PEEK, TOP] : [TOP]

  return (
    <>
      <div className="pl-deck-wrap">
        <div className="pl-deck">
          {depths.map((depth) => {
            const market = markets[(index + depth) % markets.length]
            if (!market) return null
            return (
              <div
                // Keying on the deck index remounts the stack on every
                // advance, which is what guarantees the imperative styles
                // above start from a clean node.
                key={`${index}-${depth}`}
                ref={(el) => {
                  cardRefs.current[depth] = el
                }}
                className={`pl-mcard${depth === TOP ? '' : ' pl-behind'}`}
                aria-hidden={depth !== TOP}
              >
                {/* Only the top card gets the detail affordance — the one
                    behind it is aria-hidden scenery and not interactive. */}
                <MarketCard market={market} onDetail={depth === TOP ? onDetail : undefined} />
              </div>
            )
          })}
        </div>
      </div>

      <div className="pl-actions">
        {/* intent-neutral, repainted by .pl-btn-* in styles.ts: NO is the
            other pair's lime and YES the subject pair's orange, and neither
            stock intent carries those. */}
        <Press
          shape="shape-pill"
          intent="intent-neutral"
          className="pl-btn-no"
          round
          onClick={() => swipe('no')}
          ariaLabel={t('deck.no')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Press>
        <Press
          shape="shape-pill"
          intent="intent-neutral"
          className="pl-btn-yes"
          round
          onClick={() => swipe('yes')}
          ariaLabel={t('deck.yes')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12.5l5.2 5.2L20 7" />
          </svg>
        </Press>
      </div>

      <div className="pl-swipe-hint">{t('deck.navHint')}</div>
    </>
  )
}
