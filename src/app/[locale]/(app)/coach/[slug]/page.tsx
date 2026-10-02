// Public coach page. Server-rendered: only the "+N more" lists are client islands.

import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { createAnonServerClient } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'
import {
  fetchCoachPage, splitPlayers, initials, shortPlayerName, isIndexable, formatTournamentName,
  type CoachPlayer, type CoachTitle, type UpcomingRow,
} from '@/lib/coach-page-data'
import { Link, permanentRedirect } from '@/i18n/navigation'
import { FlagImage } from '@/components/FlagImage'
import { Widget } from '../../../player/[id]/Widget'
import {
  GREEN, ORANGE, MUTED, BG_BASE, MEN_BLUE, WOMEN_PURPLE, LIVE_RED, CHUNKY,
} from '@/components/home/shared-constants'
import { ExpandableList } from './ExpandableList'

const BASE_URL = 'https://padelnachos.com'

type Props = { params: Promise<{ locale: string; slug: string }> }

// Note: these pages render dynamically (i18n reads cookies), so there is no ISR caching;
// `revalidate` is kept only as a harmless hint.
export const revalidate = 3600

const getCoach = cache((slug: string) => fetchCoachPage(createAnonServerClient(), slug))

function levelColor(level: string | null): string {
  const l = (level ?? '').toLowerCase()
  if (l === 'major' || l === 'finals') return ORANGE
  if (l.startsWith('fip')) return WOMEN_PURPLE
  return GREEN
}

function Avatar({ name, bg, size = 32 }: { name: string; bg: string; size?: number }) {
  return (
    <div aria-hidden="true" style={{
      width: size, height: size, borderRadius: '50%', background: bg, color: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.36), fontWeight: 800, flexShrink: 0,
    }}>
      {initials(name)}
    </div>
  )
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const result = await getCoach(slug)
  const t = await getTranslations({ locale, namespace: 'coach' })
  if (result.kind !== 'ok') return { title: t('pageLabel') }
  const { coach, players } = result
  const title = t('metaTitle', { name: coach.display_name })
  const description = t('metaDescription', {
    name: coach.display_name,
    players: players.slice(0, 3).map(shortPlayerName).join(', '),
  })
  return {
    title,
    description,
    ...buildAlternates(`/coach/${slug}`, locale),
    robots: isIndexable(coach) ? undefined : { index: false, follow: true },
    openGraph: { title, description, type: 'profile' },
  }
}

export default async function CoachPage({ params }: Props) {
  const { locale, slug } = await params
  const result = await getCoach(slug)
  if (result.kind === 'redirect') permanentRedirect({ href: `/coach/${result.slug}`, locale })
  if (result.kind !== 'ok') notFound()
  const { coach, players, titles, next, year } = result

  const t = await getTranslations({ locale, namespace: 'coach' })
  const format = await getFormatter({ locale })
  const { men, women } = splitPlayers(players)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: coach.display_name,
    jobTitle: 'Padel coach',
    url: locale === 'en' ? `${BASE_URL}/coach/${slug}` : `${BASE_URL}/${locale}/coach/${slug}`,
  }

  const playerRow = (p: CoachPlayer, bg: string) => (
    <Link
      key={p.id}
      href={`/player/${p.id}`}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', textDecoration: 'none', color: 'inherit' }}
    >
      <Avatar name={p.display_name || p.name} bg={bg} size={30} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.display_name || p.name}
        </span>
        <FlagImage country={p.country} size={14} />
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {p.ranking != null && <span style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>#{p.ranking}</span>}
        {p.points != null && <span style={{ fontSize: 11, color: MUTED, marginLeft: 8 }}>{Math.round(Number(p.points)).toLocaleString(locale)}</span>}
      </div>
    </Link>
  )
  const heading = (key: string, label: string) => (
    <div key={key} style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, margin: '8px 0 2px' }}>
      {label}
    </div>
  )
  const playerGroups = [
    ...(men.length ? [{ key: 'men', heading: heading('h-men', t('men')), rows: men.map((p) => playerRow(p, MEN_BLUE)) }] : []),
    ...(women.length ? [{ key: 'women', heading: heading('h-women', t('women')), rows: women.map((p) => playerRow(p, WOMEN_PURPLE)) }] : []),
  ]
  const PLAYERS_INITIAL = 6
  const listedPlayers = men.length + women.length

  const nextRow = (m: UpcomingRow) => {
    const isLive = m.status === 'live' || m.status === 'on_court'
    const chip = isLive
      ? t('live')
      : m.scheduled_at
        ? format.dateTime(new Date(m.scheduled_at), { weekday: 'short', hour: '2-digit', minute: '2-digit' })
        : ''
    return (
      <Link
        key={m.match_id}
        href={`/match/${m.match_id}`}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', textDecoration: 'none', color: 'inherit' }}
      >
        <span style={{
          background: isLive ? LIVE_RED : '#2A2A2A', color: isLive ? '#fff' : '#E2E8F0',
          fontSize: 10, fontWeight: 800, padding: '3px 7px', whiteSpace: 'nowrap',
          clipPath: CHUNKY.badge, textTransform: 'uppercase',
        }}>
          {chip}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: MUTED }}>
            {[m.round, m.tournament_name].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.pair1} {t('vs')} {m.pair2}
          </div>
        </div>
      </Link>
    )
  }

  const titleRow = (ti: CoachTitle) => (
    <Link
      key={ti.key}
      href={`/tournaments/${ti.tournamentId}`}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', textDecoration: 'none', color: 'inherit' }}
    >
      <span style={{
        background: levelColor(ti.level), color: '#000', fontSize: 9, fontWeight: 800,
        padding: '3px 6px', textTransform: 'uppercase', whiteSpace: 'nowrap', clipPath: CHUNKY.badge,
      }}>
        {(ti.level ?? '').replace(/_/g, ' ') || '—'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {formatTournamentName(ti.tournamentName)}
        </div>
        <div style={{ fontSize: 10, color: MUTED }}>
          {ti.pair}
          {ti.date ? ` · ${format.dateTime(new Date(ti.date), { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}
        </div>
      </div>
    </Link>
  )

  const tile = (label: string, value: number, count: number, color: string) => (
    <Widget label={label}>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.1 }}>
        {Math.round(Number(value)).toLocaleString(locale)}
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{t('playersCount', { count })}</div>
    </Widget>
  )

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh', padding: 12 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 4px 16px' }}>
        <Avatar name={coach.display_name} bg={ORANGE} size={58} />
        <div style={{ minWidth: 0 }}>
          <span style={{
            display: 'inline-block', background: GREEN, color: '#000', fontSize: 11, fontWeight: 800,
            padding: '3px 9px', clipPath: CHUNKY.badge, marginBottom: 4,
          }}>
            {t('rankChip', { rank: coach.rank_overall })}
          </span>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: '#E2E8F0', margin: 0, letterSpacing: '-0.01em' }}>
            {coach.display_name}
          </h1>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {t('subtitle', { players: listedPlayers, titles: titles.length, year })}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {men.length > 0 && tile(t('menPoints'), coach.men_points, men.length, GREEN)}
        {women.length > 0 && tile(t('womenPoints'), coach.women_points, women.length, ORANGE)}

        {next.length > 0 && (
          <Widget wide label={t('nextMatches')}>
            {next.map(nextRow)}
          </Widget>
        )}

        <Widget wide label={t('players')}>
          <ExpandableList
            groups={playerGroups}
            initialRows={PLAYERS_INITIAL}
            moreLabel={t('showMore', { count: Math.max(0, listedPlayers - PLAYERS_INITIAL) })}
          />
        </Widget>

        {titles.length > 0 && (
          <Widget wide label={t('titles', { year })}>
            <ExpandableList
              groups={[{ key: 'titles', heading: null, rows: titles.map(titleRow) }]}
              initialRows={4}
              moreLabel={t('showMore', { count: Math.max(0, titles.length - 4) })}
            />
            <div style={{ fontSize: 9, color: MUTED, marginTop: 8 }}>{t('titlesFootnote')}</div>
          </Widget>
        )}
      </div>
    </div>
  )
}
