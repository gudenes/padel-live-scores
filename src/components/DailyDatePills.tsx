// src/components/DailyDatePills.tsx
// Date navigation strip for /matches/[date]. Renders 7 pills (−3..+3 days
// around the selected date) as crawlable <a> links plus a prev/next arrow
// that extends the window another day.
//
// Server component by design — the pills must be in the HTML Google sees,
// not hydrated later. All labels are translated via getTranslations().

import { getTranslations } from 'next-intl/server'
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
}

/**
 * Builds a 7-pill window (−3..+3) with labels like "Thu 17", plus left/right
 * arrow links that let the user — and Googlebot — navigate further.
 */
export async function DailyDatePills({ selectedIso, locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'daily' })
  const tz = getLocaleHomeTz(locale)

  const days = [-3, -2, -1, 0, 1, 2, 3].map(offset => {
    const iso = addDaysIso(selectedIso, offset, tz)
    const isSelected = offset === 0
    const isToday = isLocaleToday(iso, locale)
    return { iso, offset, isSelected, isToday }
  })

  const prevIso = addDaysIso(selectedIso, -4, tz)
  const nextIso = addDaysIso(selectedIso, 4, tz)

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
      <PillLink
        href={`/matches/${prevIso}`}
        locale={locale}
        label="‹"
        ariaLabel={t('yesterday')}
        isSelected={false}
        isArrow
      />

      {days.map(({ iso, offset, isSelected, isToday }) => {
        // Build the parts: "label\nday"
        // For offset -1/0/+1 prefer the semantic word ("Yesterday"/"Today"/"Tomorrow")
        // over the weekday — matches how users actually talk + targets natural search.
        const [wdPart, dayPart] = partsFor(iso, tz, dayFormatter)
        let topLabel = wdPart
        if (isToday && offset === 0) topLabel = t('today')
        else if (offset === -1 && isLocaleToday(addDaysIso(iso, 1, tz), locale)) topLabel = t('yesterday')
        else if (offset === 1 && isLocaleToday(addDaysIso(iso, -1, tz), locale)) topLabel = t('tomorrow')

        return (
          <PillLink
            key={iso}
            href={`/matches/${iso}`}
            locale={locale}
            topLabel={topLabel}
            bottomLabel={dayPart}
            isSelected={isSelected}
          />
        )
      })}

      {/* Next arrow */}
      <PillLink
        href={`/matches/${nextIso}`}
        locale={locale}
        label="›"
        ariaLabel={t('tomorrow')}
        isSelected={false}
        isArrow
      />
    </nav>
  )
}

/** Produces ["Thu", "17"] from a YYYY-MM-DD in a given timezone. */
function partsFor(iso: string, tz: string, fmt: Intl.DateTimeFormat): [string, string] {
  // Use a noon UTC anchor to avoid DST edge cases.
  const d = new Date(iso + 'T12:00:00Z')
  const parts = fmt.formatToParts(d)
  let weekday = ''
  let day = ''
  for (const p of parts) {
    if (p.type === 'weekday') weekday = p.value.replace(/\.$/, '')
    if (p.type === 'day') day = p.value
  }
  // Capitalise weekday consistently (Intl returns lowercase in some locales)
  if (weekday.length > 0) weekday = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  // Suppress the TZ value since `fmt` doesn't include it — keep the hack simple.
  void tz
  return [weekday, day]
}

interface PillLinkProps {
  href: string
  locale: string
  topLabel?: string
  bottomLabel?: string
  /** Single-glyph label (for arrows). Used when topLabel/bottomLabel omitted. */
  label?: string
  ariaLabel?: string
  isSelected: boolean
  isArrow?: boolean
}

function PillLink(p: PillLinkProps) {
  const background = p.isSelected ? GREEN : BG_CARD
  const color = p.isSelected ? '#0A0A0A' : '#FFF'
  const border = p.isSelected ? GREEN : 'rgba(255,255,255,0.08)'
  const width = p.isArrow ? 32 : 54
  const minWidth = p.isArrow ? 32 : 54

  return (
    <Link
      href={p.href}
      locale={p.locale as 'en' | 'es' | 'pt' | 'it' | 'fr'}
      aria-label={p.ariaLabel}
      aria-current={p.isSelected ? 'page' : undefined}
      style={{
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
        border: `1px solid ${border}`,
        clipPath: CHUNKY_PILL,
        color,
        textDecoration: 'none',
        flexShrink: 0,
        fontFamily: 'inherit',
      }}
    >
      {p.isArrow ? (
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
            opacity: p.isSelected ? 0.9 : 0.7,
            lineHeight: 1,
          }}>
            {p.topLabel}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}>
            {p.bottomLabel}
          </span>
        </>
      )}
    </Link>
  )
}
