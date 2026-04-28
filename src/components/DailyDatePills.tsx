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

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { addDaysIso, getLocaleHomeTz, isLocaleToday } from '@/lib/locale-time'

const GREEN = '#7ED321'
const BG_BASE = '#0A0A0A'
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
}

export function DailyDatePills({ selectedIso, locale, onSelect, maxIso }: Props) {
  const t = useTranslations('daily')
  const tz = getLocaleHomeTz(locale)

  // ISO YYYY-MM-DD strings sort lexically the same as chronologically,
  // so a plain `>` comparison is enough to test "past the boundary."
  const isPastBoundary = (iso: string): boolean =>
    !!maxIso && iso > maxIso

  const days = [-3, -2, -1, 0, 1, 2, 3].map(offset => {
    const iso = addDaysIso(selectedIso, offset, tz)
    const isSelected = offset === 0
    const isToday = isLocaleToday(iso, locale)
    const disabled = isPastBoundary(iso)
    return { iso, offset, isSelected, isToday, disabled }
  })

  const prevIso = addDaysIso(selectedIso, -4, tz)
  const nextIso = addDaysIso(selectedIso, 4, tz)
  const nextDisabled = isPastBoundary(nextIso)

  // Short weekday + day of month, e.g. "jue 17", "Thu 17"
  const dayFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    timeZone: tz,
  })

  return (
    <nav
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
      }}
    >
      {/* Prev arrow */}
      <PillButton
        iso={prevIso}
        locale={locale}
        label="‹"
        ariaLabel={t('yesterday')}
        isSelected={false}
        isArrow
        onSelect={onSelect}
      />

      {days.map(({ iso, offset, isSelected, isToday, disabled }) => {
        const [wdPart, dayPart] = partsFor(iso, tz, dayFormatter)
        let topLabel = wdPart
        if (isToday && offset === 0) topLabel = t('today')
        else if (offset === -1 && isLocaleToday(addDaysIso(iso, 1, tz), locale)) topLabel = t('yesterday')
        else if (offset === 1 && isLocaleToday(addDaysIso(iso, -1, tz), locale)) topLabel = t('tomorrow')

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
    zIndex: 1,
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
      <span style={{
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        color: isActive ? GREEN : MUTED,
        opacity: isActive ? 0.95 : 0.7,
        lineHeight: 1,
      }}>
        {p.topLabel}
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1, color: '#FFF' }}>
        {p.bottomLabel}
      </span>
    </>
  )

  // Callback mode: render as <button>. Snappier — no Next.js nav, no
  // server round-trip; the parent shell swaps the cached day.
  // Disabled pills render as plain <span> in either mode so clicks +
  // middle-click-open-in-tab both no-op past the boundary.
  const node = p.disabled ? (
    <span
      aria-label={p.ariaLabel}
      aria-disabled="true"
      style={{ ...sharedStyle, font: 'inherit' }}
    >
      {inner}
    </span>
  ) : p.onSelect ? (
    <button
      type="button"
      aria-label={p.ariaLabel}
      aria-current={p.isSelected ? 'page' : undefined}
      onClick={() => p.onSelect?.(p.iso)}
      style={{ ...sharedStyle, font: 'inherit', border: `${borderWidth}px solid ${border}` }}
    >
      {inner}
    </button>
  ) : (
    <Link
      href={`/matches/${p.iso}`}
      locale={p.locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
      aria-label={p.ariaLabel}
      aria-current={p.isSelected ? 'page' : undefined}
      style={sharedStyle}
    >
      {inner}
    </Link>
  )

  // Non-active pills (and arrows) render bare — no shadow wrapper.
  if (!isActive) return node

  // Active pill: lime shadow layered behind the button/link, plus a
  // brief pulse animation. The `key={p.iso}` forces React to remount
  // the wrapper on every selection change so the CSS keyframe replays
  // from frame 0 — that's the "click registered" cue that pairs with
  // the body's matches-day-fade.
  return (
    <span
      key={p.iso}
      className="day-pill-pulse"
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexShrink: 0,
        width,
        height: 44,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          transform: 'translate(5px, 5px)',
          background: GREEN,
          clipPath: CHUNKY_PILL,
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      {node}
    </span>
  )
}
