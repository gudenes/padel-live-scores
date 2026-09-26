'use client'
// src/app/[locale]/(app)/play/_components/DeckScreen.tsx
//
// The swipe deck — a faithful port of the mockup's renderDeck / attachDrag /
// fly trio. The physics constants are the reviewed design, not guesses:
//
//   rotation      dx / 18
//   stamp opacity min(|dx| / 95, 1)
//   tint          past ±55px
//   commit        |dx| > 95px
//   fly-off       ±620px, 40px down, ±26deg, 270ms
//
// All drag work mutates the card's style directly rather than going through
// React state. A setState per pointermove would re-render the whole card
// subtree sixty times a second; the transform is a presentational detail
// that React has no reason to own.
//
// The resting transforms are applied in a layout effect rather than in JSX
// for the same reason: if React held `transform` as a prop it would clobber
// an in-progress drag on any unrelated parent re-render.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import MarketCard from './MarketCard'
import { Press } from './shared'
import type { PlayMarket, Side } from './types'

// Rendered back-to-front so the topmost card is last in the DOM and paints
// on top without a z-index ladder.
const DEPTHS = [2, 1, 0] as const
const TOP = DEPTHS.length - 1

const COMMIT_PX = 95
const TINT_PX = 55
const FLY_PX = 620
const FLY_MS = 270

// A tap, as distinct from a swipe that changed its mind: the pointer travelled
// almost nowhere and was down briefly. Deliberately far below COMMIT_PX — a
// 60px drag that snaps back is an aborted swipe, not a request to read more.
const TAP_PX = 9
const TAP_MS = 450

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function restingTransform(depth: number): string {
  return `translateY(${depth * -9}px) scale(${1 - depth * 0.035})`
}

function restingOpacity(depth: number): string {
  return depth === 2 ? '.45' : depth === 1 ? '.75' : '1'
}

export interface DeckScreenProps {
  markets: PlayMarket[]
  /** Index of the top card. Owned by the page so a completed trade advances it. */
  index: number
  onCommit: (market: PlayMarket, side: Side) => void
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
  onDetail,
  active,
}: DeckScreenProps) {
  const t = useTranslations('play')
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  // A card is mid-flight; ignore further input until it lands.
  const busyRef = useRef(false)
  // Kept in a ref so the pointer handlers, which are attached once per
  // card, always call the current callback without re-attaching. Assigned
  // in an effect rather than during render — the handlers only read it
  // later, from a user gesture.
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  }, [onCommit])
  const detailRef = useRef(onDetail)
  useEffect(() => {
    detailRef.current = onDetail
  }, [onDetail])

  // Reset every card to its resting pose whenever the deck advances.
  useLayoutEffect(() => {
    busyRef.current = false
    cardRefs.current.forEach((el, i) => {
      if (!el) return
      const depth = DEPTHS[i]!
      el.classList.remove('pl-anim', 'pl-tint-yes', 'pl-tint-no')
      el.style.transform = restingTransform(depth)
      el.style.opacity = restingOpacity(depth)
      el.querySelectorAll<HTMLElement>('.pl-stamp').forEach((s) => {
        s.style.opacity = '0'
      })
    })
  }, [index, markets])

  const fly = useCallback((el: HTMLDivElement, market: PlayMarket, side: Side) => {
    busyRef.current = true
    el.classList.add('pl-anim')
    const stamp = el.querySelector<HTMLElement>(side === 'yes' ? '.pl-s-yes' : '.pl-s-no')
    if (stamp) stamp.style.opacity = '1'
    const dir = side === 'yes' ? 1 : -1
    el.style.transform = `translate(${dir * FLY_PX}px, 40px) rotate(${dir * 26}deg)`
    el.style.opacity = '0'
    // Reduced motion: no travel, just hand off. The .pl-anim transition is
    // already shortened to an opacity fade by the media query in styles.ts.
    const delay = prefersReducedMotion() ? 0 : FLY_MS
    window.setTimeout(() => {
      busyRef.current = false
      commitRef.current(market, side)
    }, delay)
  }, [])

  /** Programmatic swipe — the round buttons and the arrow keys. */
  const swipe = useCallback(
    (side: Side) => {
      if (busyRef.current || markets.length === 0) return
      const el = cardRefs.current[TOP]
      const market = markets[index % markets.length]
      if (!el || !market) return
      fly(el, market, side)
    },
    [fly, index, markets],
  )

  // Drag, attached to the top card only.
  useEffect(() => {
    const el = cardRefs.current[TOP]
    if (!el || markets.length === 0) return
    const market = markets[index % markets.length]
    if (!market) return

    const yes = el.querySelector<HTMLElement>('.pl-s-yes')
    const no = el.querySelector<HTMLElement>('.pl-s-no')

    let startX = 0
    let startY = 0
    let dx = 0
    let dy = 0
    let dragging = false
    let pointerId: number | null = null
    let downAt = 0

    const paint = () => {
      const rot = dx / 18
      const t = Math.min(Math.abs(dx) / COMMIT_PX, 1)
      el.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${rot}deg)`
      if (yes) yes.style.opacity = dx > 0 ? String(t) : '0'
      if (no) no.style.opacity = dx < 0 ? String(t) : '0'
      el.classList.toggle('pl-tint-yes', dx > TINT_PX)
      el.classList.toggle('pl-tint-no', dx < -TINT_PX)
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
      el.classList.remove('pl-anim')
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
      if (Math.abs(dx) > COMMIT_PX) {
        fly(el, market, dx > 0 ? 'yes' : 'no')
      } else {
        // Snap back.
        el.classList.add('pl-anim')
        el.style.transform = 'translate(0,0) rotate(0deg)'
        if (yes) yes.style.opacity = '0'
        if (no) no.style.opacity = '0'
        el.classList.remove('pl-tint-yes', 'pl-tint-no')

        // A tap, not an aborted swipe: open the detail sheet. The card is left
        // exactly as it was — no advance, no side taken. `setPointerCapture`
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
  }, [fly, index, markets])

  // ArrowLeft / ArrowRight, only while the deck is the visible screen.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') swipe('yes')
      else if (e.key === 'ArrowLeft') swipe('no')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, swipe])

  return (
    <>
      <div className="pl-deck-wrap">
        <div className="pl-deck">
          {DEPTHS.map((depth, i) => {
            const market = markets[(index + depth) % markets.length]
            if (!market) return null
            return (
              <div
                // Keying on the deck index remounts the stack on every
                // advance, which is what guarantees the imperative styles
                // above start from a clean node.
                key={`${index}-${depth}`}
                ref={(el) => {
                  cardRefs.current[i] = el
                }}
                className={`pl-mcard${depth ? ' pl-behind' : ''}`}
                aria-hidden={depth > 0}
              >
                {/* Only the top card gets the detail affordance — the two
                    behind it are aria-hidden scenery and not interactive. */}
                <MarketCard market={market} onDetail={depth === 0 ? onDetail : undefined} />
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

      <div className="pl-swipe-hint">
        {t.rich('deck.swipeHint', {
          no: (chunks) => <b>{chunks}</b>,
          yes: (chunks) => <i>{chunks}</i>,
        })}
      </div>
    </>
  )
}
