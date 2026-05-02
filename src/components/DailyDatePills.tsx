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
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const CHUNKY_PILL = 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)'

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
  /**
   * Live swipe-commit progress in [-1, 1].
   *  +1 = fully toward `nextIso` (tomorrow).
   *  -1 = fully toward `prevIso` (yesterday).
   *  0  = at rest, indicator sits on the active pill.
   * The lime indicator slides between pills proportionally so the user
   * can see the swipe commitment in the picker as well as the body.
   */
  swipeProgress?: number
  /** True while the user is mid-swipe — disables the indicator's CSS
   *  transition so it tracks the finger 1:1. When false, the indicator
   *  springs back to the active pill with the body's snap-back. */
  swipeActive?: boolean
}

export function DailyDatePills({
  selectedIso,
  locale,
  onSelect,
  maxIso,
  swipeProgress = 0,
  swipeActive = false,
}: Props) {
  const t = useTranslations('daily')
  const tz = getLocaleHomeTz(locale)

  // ── G2 (Slide+Spring → Spring+Cascade) animation refs ──────────
  // The active pill is filled solid lime — same idiom as primary CTAs
  // across the site. Spring kick + letter cascade fire on every active
  // change; no separate sliding marker (the lime fill carries enough
  // visual weight on its own). See `mockup-day-picker-colors.html`.
  const navRef = useRef<HTMLElement | null>(null)
  const pillRefs = useRef<Map<string, HTMLElement>>(new Map())
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

  // Floating lime indicator that slides between active and target pill
  // as the user swipes. At rest it sits exactly on the active pill —
  // visually equivalent to the active pill's solid lime fill.
  const indicatorRef = useRef<HTMLDivElement | null>(null)

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

  // First-mount: scroll so the active pill is centred in view. After
  // that, the strip stays put on every selection change — the active
  // pill changes class (and the kick + letter cascade fire) but the
  // scroll position belongs to the user. The exception: tapping
  // "today" smooth-scrolls the strip back to centre today.
  useLayoutEffect(() => {
    const nav = navRef.current
    const activePill = pillRefs.current.get(selectedIso)
    if (!nav || !activePill) return

    const navRect = nav.getBoundingClientRect()
    const pillRect = activePill.getBoundingClientRect()

    if (!hasInitialScrolledRef.current) {
      hasInitialScrolledRef.current = true
      const navWidth = nav.clientWidth
      const pillCenter =
        pillRect.left - navRect.left + nav.scrollLeft + pillRect.width / 2
      nav.scrollLeft = Math.max(0, pillCenter - navWidth / 2)
      return
    }

    // When the selection becomes "today", smoothly scroll the strip
    // so today's pill is centred. Other selections leave the scroll
    // position alone (the user's explicit scroll is preserved per
    // the "stay put" behaviour).
    if (isLocaleToday(selectedIso, locale)) {
      const navWidth = nav.clientWidth
      const pillCenter =
        pillRect.left - navRect.left + nav.scrollLeft + pillRect.width / 2
      const targetScroll = Math.max(0, pillCenter - navWidth / 2)
      if (Math.abs(nav.scrollLeft - targetScroll) > 1) {
        nav.scrollTo({ left: targetScroll, behavior: 'smooth' })
      }
    }
  }, [selectedIso, locale])

  // Position the floating lime indicator. At rest it sits exactly on
  // the active pill so the visual is identical to the static lime fill.
  // Mid-swipe the position lerps toward the target pill so the user
  // sees the day picker react to the gesture in real time.
  useLayoutEffect(() => {
    const indicator = indicatorRef.current
    const active = pillRefs.current.get(selectedIso)
    if (!indicator || !active) return

    const targetIso = swipeProgress > 0 ? nextIso : prevIso
    const target = pillRefs.current.get(targetIso) ?? active
    const t = Math.min(1, Math.abs(swipeProgress))

    const left = active.offsetLeft + (target.offsetLeft - active.offsetLeft) * t
    const top = active.offsetTop + (target.offsetTop - active.offsetTop) * t
    const width = active.offsetWidth + (target.offsetWidth - active.offsetWidth) * t
    const height = active.offsetHeight + (target.offsetHeight - active.offsetHeight) * t

    indicator.style.left = `${left}px`
    indicator.style.top = `${top}px`
    indicator.style.width = `${width}px`
    indicator.style.height = `${height}px`
  }, [selectedIso, swipeProgress, prevIso, nextIso])

  // Compute the active swipe target iso so each pill knows whether it
  // is the destination of the current gesture and can crossfade its
  // text accordingly. At rest (`swipeProgress === 0`) no pill is the
  // target, so only the active pill carries lime styling.
  const targetIso = swipeProgress === 0
    ? null
    : swipeProgress > 0 ? nextIso : prevIso
  const swipeMagnitude = Math.min(1, Math.abs(swipeProgress))

  // Cubic-bezier ease for the indicator's snap-back when the user
  // releases without committing. Matches the body's snap-back timing.
  const indicatorTransition = swipeActive
    ? 'none'
    : 'left 220ms cubic-bezier(0.16, 1, 0.3, 1), top 220ms cubic-bezier(0.16, 1, 0.3, 1), width 220ms cubic-bezier(0.16, 1, 0.3, 1), height 220ms cubic-bezier(0.16, 1, 0.3, 1)'

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
      {/* Floating lime indicator. Sits in the same scroll container as
          the pills so it scrolls with them. Position is set imperatively
          in the layout effect above. Initially hidden (left: -9999px)
          so the SSR paint shows the active pill's static lime fill;
          once the layout effect runs (synchronously before paint after
          mount), the indicator snaps onto the active pill. */}
      <div
        ref={indicatorRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: -9999,
          top: 0,
          width: 0,
          height: 0,
          background: GREEN,
          clipPath: CHUNKY_PILL,
          pointerEvents: 'none',
          zIndex: 1,
          transition: indicatorTransition,
        }}
      />

      {/* Prev arrow — does NOT register in pillRefs because it shares
          the iso key with the actual day pill rendered in the days
          array; the day pill is what the indicator lerps toward. */}
      <PillButton
        iso={prevIso}
        locale={locale}
        label="‹"
        ariaLabel={t('yesterday')}
        isSelected={false}
        isArrow
        onSelect={onSelect}
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

        // Per-pill swipe overlap drives bg/text crossfade. Active pill
        // sheds lime (1 → 0) as the gesture commits; target pill gains
        // it (0 → 1). Other pills are untouched.
        const isTarget = iso === targetIso
        const swipeOverlap = isSelected
          ? 1 - swipeMagnitude
          : isTarget ? swipeMagnitude : 0

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
            swipeOverlap={swipeOverlap}
            registerRef={(el) => {
              if (el) pillRefs.current.set(iso, el)
              else pillRefs.current.delete(iso)
            }}
          />
        )
      })}

      {/* Next arrow — see comment above the prev arrow. */}
      <PillButton
        iso={nextIso}
        locale={locale}
        label="›"
        ariaLabel={t('tomorrow')}
        isSelected={false}
        isArrow
        disabled={nextDisabled}
        onSelect={onSelect}
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
  /** How "lime" this pill should look right now, in [0, 1].
   *  1 = the floating indicator is fully on this pill (its text is
   *  dark on lime). 0 = no indicator overlap (default state).
   *  Drives the bg + text crossfade during a swipe so the pill
   *  visually hands the lime indicator off to its neighbour. */
  swipeOverlap?: number
}

function PillButton(p: PillButtonProps) {
  const isActive = p.isSelected && !p.isArrow
  // G2: active pills are SOLID LIME — same idiom as the site's primary
  // CTAs (login/follow/active nav). Dark text on lime bg.
  // The active pill's static lime fill is what SSR paints — the floating
  // indicator on top covers it identically at rest. During a swipe, the
  // active pill's lime fades out (`swipeOverlap` drops 1 → 0) as the
  // indicator slides away, while the target pill's `swipeOverlap` rises
  // 0 → 1 — but the target pill's *background* stays neutral; the
  // indicator covering it provides the lime. So we only need to fade
  // the active pill's bg.
  const overlap = p.swipeOverlap ?? (isActive ? 1 : 0)
  const isSwiping = (p.swipeOverlap ?? -1) >= 0 && p.swipeOverlap !== (isActive ? 1 : 0)
  const background = isActive
    ? `rgba(126, 211, 33, ${overlap})`
    : BG_CARD
  // Text crossfades dark ↔ white with overlap. At overlap=1 (lime under),
  // text is dark; at overlap=0 (no lime), text is white.
  const color = lerpHex('#0A0A0A', '#FFFFFF', 1 - overlap)
  const border = isActive ? GREEN : 'rgba(255,255,255,0.08)'
  const borderWidth = isActive ? 1.5 : 1
  const width = p.isArrow ? 36 : 76
  const minWidth = p.isArrow ? 36 : 76

  const sharedStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    width,
    minWidth,
    height: 52,
    padding: '6px 4px',
    background,
    border: `${borderWidth}px solid ${border}`,
    clipPath: CHUNKY_PILL,
    color,
    textDecoration: 'none',
    flexShrink: 0,
    fontFamily: 'inherit',
    position: 'relative',
    // Mid-swipe pills (active + target) sit ABOVE the indicator block
    // so their text remains crisp on the lime fill. Other pills sit
    // below so the indicator can pass over them visually if it ever
    // travels through.
    zIndex: isSwiping ? 3 : 2,
    cursor: p.disabled ? 'not-allowed' : 'pointer',
    opacity: p.disabled ? 0.32 : 1,
    pointerEvents: p.disabled ? 'none' : 'auto',
  }

  // Top-label colour crossfades muted ↔ near-dark with overlap, mirroring
  // the bottom label so the cascade lands on the right tone.
  const topColor = lerpHex('#5A5A5A', MUTED, 1 - overlap)
  const bottomColor = lerpHex('#0A0A0A', '#FFFFFF', 1 - overlap)
  const topOpacity = 0.7 + 0.3 * overlap

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
          color: topColor,
          opacity: topOpacity,
          lineHeight: 1,
        }}
      />
      <CascadeText
        text={p.bottomLabel ?? ''}
        active={isActive}
        style={{
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.1,
          color: bottomColor,
        }}
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

// Linear interpolation between two CSS hex colours (e.g. "#0A0A0A").
// Used to crossfade pill text colour as the swipe indicator slides
// between active and target pills. Pure function — no DOM access.
function lerpHex(a: string, b: string, t: number): string {
  const ax = parseInt(a.slice(1), 16)
  const bx = parseInt(b.slice(1), 16)
  const ar = (ax >> 16) & 0xff, ag = (ax >> 8) & 0xff, ab = ax & 0xff
  const br = (bx >> 16) & 0xff, bg = (bx >> 8) & 0xff, bb = bx & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `rgb(${r}, ${g}, ${bl})`
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
