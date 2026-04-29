'use client'

// src/components/DailyDatePills.tsx
// Date navigation strip for /matches/[date]. Renders 7 pills (−3..+3 days
// around the selected date) plus a prev/next arrow that extends the
// window another day.
//
// Two modes:
//   - Link mode (default) — pills render as crawlable <a> links. Used on
//     SSR / initial paint so Google sees the navigation in HTML.
//   - Callback mode — when `onSelect` is supplied, pills render as
//     buttons that call the parent. Used by MatchesDayShell to swap
//     days client-side from the prefetched cache (no server round-trip).
//
// `selectedIso` is reactive — when the parent updates it, the pills
// shift their −3..+3 window so the active pill is always centered.

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { addDaysIso, getLocaleHomeTz, isLocaleToday } from '@/lib/locale-time'

const GREEN = '#7ED321'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const CHUNKY_PILL = 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)'

// Chunky-shadow offset relative to the active pill. Baked into the
// JS-set CSS variables so the static transform rule can stay simple.
const SHADOW_OFFSET_X = 5
const SHADOW_OFFSET_Y = 5

interface Props {
  /** Currently selected date as YYYY-MM-DD in locale home TZ. */
  selectedIso: string
  locale: string
  /**
   * Optional click handler. When provided, pills render as buttons and
   * call this with the target ISO instead of navigating. Used by the
   * client-side day-swap shell.
   */
  onSelect?: (iso: string) => void
  /**
   * Optional forward boundary (YYYY-MM-DD). Pills + arrow that target
   * a date strictly after this iso render as disabled. Lets the shell
   * cap the day picker at the latest day with actual data, so users
   * don't endlessly scroll into empty days.
   *
   * Computed by the shell as `max(today + 3, maxScheduledIso)` — at
   * least 3 days forward is always reachable; if matches go further
   * than that, the cap extends to wherever data ends.
   */
  maxIso?: string
}

export function DailyDatePills({ selectedIso, locale, onSelect, maxIso }: Props) {
  const t = useTranslations('daily')
  const tz = getLocaleHomeTz(locale)

  // ── Option α animation refs ──────────────────────────────────
  // Single shared chunky-lime shadow that physically slides between
  // active pills. Plus a spring kick on the new active pill and a
  // letter cascade on its labels. See
  // `mockup-day-picker-animations.html` (Option α).
  const navRef = useRef<HTMLElement | null>(null)
  const shadowRef = useRef<HTMLDivElement | null>(null)
  const pillRefs = useRef<Map<string, HTMLElement>>(new Map())
  // Tracks whether we've positioned the shadow at least once. First
  // mount snaps the shadow into place without an animation.
  const isFirstPositionRef = useRef(true)
  // First-mount scroll: position the strip so the active pill is
  // visible. After that, the strip stays put — the user explicitly
  // chooses when to scroll for more dates.
  const hasInitialScrolledRef = useRef(false)

  // Anchor the rendered window to the FIRST selectedIso the picker
  // saw. The window doesn't shift on subsequent selections — clicking
  // a pill only changes which one is active, leaving the strip in
  // place. The user can horizontally scroll to find more dates.
  // (Previously we re-centered around selectedIso on every change,
  // which made the active pill always end up in the middle and
  // hollowed out the slide animation.)
  const initialAnchorRef = useRef(selectedIso)
  const RANGE_DAYS = 30

  // ISO YYYY-MM-DD strings sort lexically the same as chronologically,
  // so a plain `>` comparison is enough to test "past the boundary."
  const isPastBoundary = (iso: string): boolean =>
    !!maxIso && iso > maxIso

  const days: Array<{
    iso: string
    offset: number
    isSelected: boolean
    isToday: boolean
    disabled: boolean
  }> = []
  for (let offset = -RANGE_DAYS; offset <= RANGE_DAYS; offset++) {
    const iso = addDaysIso(initialAnchorRef.current, offset, tz)
    const isSelected = iso === selectedIso
    const isToday = isLocaleToday(iso, locale)
    const disabled = isPastBoundary(iso)
    days.push({ iso, offset, isSelected, isToday, disabled })
  }

  // Prev/Next arrows now navigate by ±1 day (matching their aria
  // labels "yesterday" / "tomorrow"). They no longer need their own
  // ref entries — they're transient nav buttons that hand off to the
  // existing pill click handler.
  const prevIso = addDaysIso(selectedIso, -1, tz)
  const nextIso = addDaysIso(selectedIso, 1, tz)
  const nextDisabled = isPastBoundary(nextIso)

  // Short weekday + day of month, e.g. "jue 17", "Thu 17"
  const dayFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    timeZone: tz,
  })

  // Position the shared shadow under the active pill. Pills are now
  // anchored — they don't shift on selection — so the slide reads as
  // a real lateral motion: shadow goes from where it was to wherever
  // the new active pill sits.
  //
  // The +5/+5 chunky-shadow offset is baked into the values we set
  // (the CSS just does `translate3d(var(--shadow-x), var(--shadow-y))`
  // — see globals.css for why the calc() wrapper had to go).
  useLayoutEffect(() => {
    const nav = navRef.current
    const shadow = shadowRef.current
    const activePill = pillRefs.current.get(selectedIso)
    if (!nav || !shadow || !activePill) return

    const navRect = nav.getBoundingClientRect()
    const pillRect = activePill.getBoundingClientRect()
    const toX = pillRect.left - navRect.left + nav.scrollLeft + SHADOW_OFFSET_X
    const toY = pillRect.top - navRect.top + SHADOW_OFFSET_Y

    nav.style.setProperty('--shadow-y', `${toY}px`)

    if (isFirstPositionRef.current) {
      nav.style.setProperty('--shadow-x', `${toX}px`)
      nav.style.setProperty('--shadow-x-from', `${toX}px`)
      shadow.classList.add('day-shadow--visible')
      isFirstPositionRef.current = false

      // First mount: bring the active pill into view by scrolling
      // the strip so the pill sits roughly in the middle of the
      // viewport. We do this once; from then on the strip stays put.
      if (!hasInitialScrolledRef.current) {
        hasInitialScrolledRef.current = true
        const navWidth = nav.clientWidth
        const pillCenter = pillRect.left - navRect.left + nav.scrollLeft + pillRect.width / 2
        nav.scrollLeft = Math.max(0, pillCenter - navWidth / 2)
      }
      return
    }

    // Read the shadow's current position from the inline CSS var so
    // the slide always starts where the shadow visibly is. (Reading
    // a var on the parent picks up whatever was last set, even if
    // the keyframe is mid-flight — but that's fine because the
    // animation class is toggled below to restart cleanly.)
    const currentX = parseFloat(nav.style.getPropertyValue('--shadow-x') || `${toX}`)
    nav.style.setProperty('--shadow-x-from', `${currentX}`)
    nav.style.setProperty('--shadow-x', `${toX}px`)
    shadow.classList.add('day-shadow--visible')

    // Force animation restart by toggling the class.
    nav.classList.remove('day-picker--sliding')
    void nav.offsetWidth
    nav.classList.add('day-picker--sliding')

    // When the selection becomes "today", smoothly scroll the strip
    // so today's pill is centred. The shadow slide and the scroll run
    // in parallel — both end with today visibly under the shadow.
    // Other selections leave the scroll position alone (the user's
    // explicit scroll is preserved per the new "stay put" behaviour).
    if (isLocaleToday(selectedIso, locale)) {
      const navWidth = nav.clientWidth
      const pillCenter =
        pillRect.left - navRect.left + nav.scrollLeft + pillRect.width / 2
      const targetScroll = Math.max(0, pillCenter - navWidth / 2)
      if (Math.abs(nav.scrollLeft - targetScroll) > 1) {
        nav.scrollTo({ left: targetScroll, behavior: 'smooth' })
      }
    }

    const ANIM_MS = 360
    const cleanup = window.setTimeout(() => {
      nav.classList.remove('day-picker--sliding')
    }, ANIM_MS + 40)
    return () => window.clearTimeout(cleanup)
  }, [selectedIso, locale])

  return (
    <nav
      ref={navRef}
      className="day-picker"
      aria-label={t('backToMatches')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '12px 16px 8px',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        position: 'relative',
      }}
    >
      {/* Shared lime offset-shadow that slides between active pills.
          Owned by the nav via CSS vars set in the layout effect. */}
      <div ref={shadowRef} className="day-shadow" aria-hidden />

      {/* Prev arrow */}
      <PillButton
        iso={prevIso}
        locale={locale}
        label="‹"
        ariaLabel={t('yesterday')}
        isSelected={false}
        isArrow
        onSelect={onSelect}
        registerRef={(el) => {
          if (el) pillRefs.current.set(prevIso, el)
          else pillRefs.current.delete(prevIso)
        }}
      />

      {days.map(({ iso, isSelected, isToday, disabled }) => {
        const [wdPart, dayPart] = partsFor(iso, tz, dayFormatter)
        // Special labels for today / yesterday / tomorrow — applied
        // by absolute date check, not by offset from the anchor (the
        // anchor is now stable, so offset-based checks would only
        // work when the user happened to land on today).
        let topLabel = wdPart
        if (isToday) topLabel = t('today')
        else if (isLocaleToday(addDaysIso(iso, 1, tz), locale)) topLabel = t('yesterday')
        else if (isLocaleToday(addDaysIso(iso, -1, tz), locale)) topLabel = t('tomorrow')

        return (
          <PillButton
            key={iso}
            iso={iso}
            locale={locale}
            topLabel={topLabel}
            bottomLabel={dayPart}
            isSelected={isSelected}
            disabled={disabled}
            onSelect={onSelect}
            registerRef={(el) => {
              if (el) pillRefs.current.set(iso, el)
              else pillRefs.current.delete(iso)
            }}
          />
        )
      })}

      {/* Next arrow */}
      <PillButton
        iso={nextIso}
        locale={locale}
        label="›"
        ariaLabel={t('tomorrow')}
        isSelected={false}
        isArrow
        disabled={nextDisabled}
        onSelect={onSelect}
        registerRef={(el) => {
          if (el) pillRefs.current.set(nextIso, el)
          else pillRefs.current.delete(nextIso)
        }}
      />
    </nav>
  )
}

/** Produces ["Thu", "17"] from a YYYY-MM-DD in a given timezone. */
function partsFor(iso: string, tz: string, fmt: Intl.DateTimeFormat): [string, string] {
  const d = new Date(iso + 'T12:00:00Z')
  const parts = fmt.formatToParts(d)
  let weekday = ''
  let day = ''
  for (const p of parts) {
    if (p.type === 'weekday') weekday = p.value.replace(/\.$/, '')
    if (p.type === 'day') day = p.value
  }
  if (weekday.length > 0) weekday = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  void tz
  return [weekday, day]
}

interface PillButtonProps {
  iso: string
  locale: string
  topLabel?: string
  bottomLabel?: string
  /** Single-glyph label (for arrows). Used when topLabel/bottomLabel omitted. */
  label?: string
  ariaLabel?: string
  isSelected: boolean
  isArrow?: boolean
  /** When true, the pill renders muted with `pointer-events: none` and
   *  `aria-disabled`. Click handlers are short-circuited; in link mode
   *  the <Link> degrades to a plain <span> so middle-click + open-in-tab
   *  also doesn't navigate past the boundary. */
  disabled?: boolean
  onSelect?: (iso: string) => void
  /** Stores a DOM ref keyed by iso in the parent's pillRefs map. */
  registerRef?: (el: HTMLElement | null) => void
}

function PillButton(p: PillButtonProps) {
  const isActive = p.isSelected && !p.isArrow
  const background = p.isSelected
    ? p.isArrow
      ? GREEN
      : BG_BASE
    : BG_CARD
  const color = p.isSelected && p.isArrow ? '#0A0A0A' : '#FFF'
  const border = p.isSelected ? GREEN : 'rgba(255,255,255,0.08)'
  const borderWidth = isActive ? 1.5 : 1
  const width = p.isArrow ? 32 : 54
  const minWidth = p.isArrow ? 32 : 54

  const sharedStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    width,
    minWidth,
    height: 44,
    padding: '4px 2px',
    background,
    border: `${borderWidth}px solid ${border}`,
    clipPath: CHUNKY_PILL,
    color,
    textDecoration: 'none',
    flexShrink: 0,
    fontFamily: 'inherit',
    position: 'relative',
    zIndex: 2,
    cursor: p.disabled ? 'not-allowed' : 'pointer',
    opacity: p.disabled ? 0.32 : 1,
    pointerEvents: p.disabled ? 'none' : 'auto',
  }

  const inner = p.isArrow ? (
    <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: p.isSelected ? '#0A0A0A' : MUTED }}>
      {p.label}
    </span>
  ) : (
    <>
      <CascadeText
        text={p.topLabel ?? ''}
        active={isActive}
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: isActive ? GREEN : MUTED,
          opacity: isActive ? 0.95 : 0.7,
          lineHeight: 1,
        }}
      />
      <CascadeText
        text={p.bottomLabel ?? ''}
        active={isActive}
        style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1, color: '#FFF' }}
      />
    </>
  )

  const handleClick = () => {
    p.onSelect?.(p.iso)
  }

  const className = isActive ? 'day-pill day-pill--active' : 'day-pill'

  // Callback mode: render as <button>. Snappier — no Next.js nav, no
  // server round-trip; the parent shell swaps the cached day.
  // Disabled pills render as plain <span> in either mode so clicks +
  // middle-click-open-in-tab both no-op past the boundary.
  if (p.disabled) {
    return (
      <span
        ref={(el) => p.registerRef?.(el)}
        className={className}
        aria-label={p.ariaLabel}
        aria-disabled="true"
        style={{ ...sharedStyle, font: 'inherit' }}
      >
        {inner}
      </span>
    )
  }
  if (p.onSelect) {
    return (
      <button
        ref={(el) => p.registerRef?.(el)}
        type="button"
        className={className}
        aria-label={p.ariaLabel}
        aria-current={p.isSelected ? 'page' : undefined}
        onClick={handleClick}
        style={{ ...sharedStyle, font: 'inherit', border: `${borderWidth}px solid ${border}` }}
      >
        {inner}
      </button>
    )
  }
  return (
    <Link
      ref={(el) => p.registerRef?.(el)}
      href={`/matches/${p.iso}`}
      locale={p.locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
      className={className}
      aria-label={p.ariaLabel}
      aria-current={p.isSelected ? 'page' : undefined}
      style={sharedStyle}
    >
      {inner}
    </Link>
  )
}

// Splits a string into per-character spans so the active pill's
// labels can cascade in via CSS. Delays are deterministic
// (charCode-based) to stay SSR-safe — Math.random would trip
// hydration. Same trick the BottomNav uses.
function CascadeText({
  text,
  active,
  style,
}: {
  text: string
  active: boolean
  style?: React.CSSProperties
}) {
  const chars = useMemo(() => {
    return text.split('').map((ch, i) => {
      const seed = (ch.charCodeAt(0) * 13 + i * 7) % 30
      return { ch, delay: i * 14 + seed }
    })
  }, [text])
  void active
  return (
    <span style={style} aria-label={text}>
      {chars.map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="day-pill-ch"
          style={{ animationDelay: `${c.delay}ms` }}
        >
          {c.ch}
        </span>
      ))}
    </span>
  )
}
