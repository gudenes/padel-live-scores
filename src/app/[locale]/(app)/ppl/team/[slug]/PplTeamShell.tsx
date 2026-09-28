'use client'

// Franchise page body: hero, division switch, totals, and three panels.
//
// All three panels render into the DOM and the inactive ones are hidden with
// `display: none`, copied deliberately from the SNP TeamPageShell. The point
// is that a crawler sees the squad and the results without running the tab
// state — conditional rendering would look identical to a user and quietly
// empty the page for search.

import { useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useRouter } from '@/i18n/navigation'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import { FlagImage } from '@/components/FlagImage'
import {
  CHUNKY, GREEN, MUTED, BORDER, BG_CARD, MEN_BLUE, WOMEN_PURPLE,
} from '@/components/home/shared'
import { DATE_SHORT } from '@/lib/format-patterns'
import { divisionLabel, eventCityFromSlug, type PplLevel } from '@/lib/ppl-hub'
import type { PplTeamPageData } from '@/lib/ppl-team-data'
import type { TieView } from '@/lib/ppl-team'

type Tab = 'results' | 'squad'

/** Server-shaped data, with the Maps flattened for the boundary. */
type ShellData = Omit<PplTeamPageData, 'opponentNames' | 'eventNames'> & {
  opponentNames: Record<string, string>
  eventNames: Record<string, { name: string; externalId: string | null }>
}

export default function PplTeamShell({ data }: { data: ShellData }) {
  const t = useTranslations('ppl')
  const format = useFormatter()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('results')

  const accent = data.team.brandColor || GREEN

  return (
    <>
      {/* Hero */}
      <div style={{ position: 'relative', padding: '16px 16px 14px' }}>
        <button
          onClick={() => router.push('/ppl')}
          aria-label={t('title')}
          style={{
            background: 'none', border: 'none', color: MUTED, cursor: 'pointer',
            padding: 0, fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
            letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 12,
          }}
        >
          ‹ {t('title')}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Crest name={data.team.name} url={data.team.crestUrl} color={accent} size={58} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{
              margin: 0, fontSize: 22, fontWeight: 800, color: '#E2E8F0',
              letterSpacing: '-0.02em', lineHeight: 1.15,
            }}>{data.team.name}</h1>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
              {[data.team.city, divisionLabel(data.level)].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      </div>

      {/* Division switch — only when the franchise actually runs both squads.
          A single-division club showing a disabled toggle would imply a page
          that exists and does not. */}
      {data.availableLevels.length > 1 && (
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 12px' }}>
          {data.availableLevels.map((lv: PplLevel) => {
            const active = lv === data.level
            return (
              <Link
                key={lv}
                href={`/ppl/team/${data.team.slug}${lv === 'ppl_ii' ? '?division=ppl_ii' : ''}` as Parameters<typeof Link>[0]['href']}
                style={{
                  padding: '6px 18px', textDecoration: 'none',
                  fontWeight: 800, fontSize: 12, letterSpacing: '0.04em',
                  textTransform: 'uppercase', clipPath: CHUNKY.button,
                  background: active ? GREEN : 'rgba(255,255,255,0.05)',
                  color: active ? '#000' : MUTED,
                }}
              >
                {divisionLabel(lv)}
              </Link>
            )
          })}
        </div>
      )}

      {/* Standing + totals. The standing is upstream's; the ties/courts are
          derived from the very rows listed below, so the strip and the list
          cannot disagree on screen. */}
      <div style={{ display: 'flex', gap: 6, padding: '0 16px 14px' }}>
        <Stat
          label={data.standing?.scope && data.standing.scope !== 'all'
            ? t(data.standing.scope === 'men' ? 'scopeMen' : 'scopeWomen')
            : t('colPoints')}
          value={data.standing?.points != null ? String(data.standing.points) : '–'}
          sub={data.standing?.rank != null ? `#${data.standing.rank}` : undefined}
          accent={GREEN}
        />
        <Stat label={t('colTiesShort')} value={`${data.totals.tiesWon}/${data.totals.tiesPlayed}`} />
        <Stat label={t('colCourts')} value={`${data.totals.courtsWon}–${data.totals.courtsLost}`} />
      </div>

      <SlidingInkTabs<Tab>
        tabs={[
          { key: 'results', label: t('tabResults') },
          { key: 'squad', label: t('tabSquad') },
        ]}
        activeKey={tab}
        onChange={setTab}
        containerStyle={{ margin: '0 16px', borderBottom: `1px solid ${BORDER}` }}
        tabStyle={{ padding: '10px 0', fontSize: 13, letterSpacing: '0.04em' }}
      />

      <div style={{ display: tab === 'results' ? 'block' : 'none', padding: '12px 16px 0' }}>
        {data.ties.length === 0
          ? <Empty text={t('noTies')} />
          : data.ties.map((tie) => (
              <TieCard
                key={tie.tieId}
                tie={tie}
                opponent={data.opponentNames[tie.opponentSeasonId] ?? '—'}
                eventLabel={eventCityFromSlug(data.eventNames[tie.tournamentId]?.externalId)
                  ?? data.eventNames[tie.tournamentId]?.name ?? ''}
                roster={data.roster}
                format={format}
                t={t}
              />
            ))}
      </div>

      <div style={{ display: tab === 'squad' ? 'block' : 'none', padding: '12px 16px 0' }}>
        {data.roster.length === 0
          ? <Empty text={t('noRoster')} />
          : data.roster.map((p) => (
              <Link
                key={p.playerId}
                href={`/player/${p.playerId}` as Parameters<typeof Link>[0]['href']}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', marginBottom: 6, textDecoration: 'none',
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${BORDER}`, clipPath: CHUNKY.card,
                }}
              >
                <PlayerAvatar name={p.displayName?.trim() || p.name} url={p.avatarUrl} country={p.country} />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600,
                  color: (p.gamesPlayed ?? 0) > 0 ? '#E2E8F0' : MUTED,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{p.displayName?.trim() || p.name}</span>
                <span style={{ fontSize: 11, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                  {(p.gamesPlayed ?? 0) > 0
                    ? t('playerRecord', { games: p.gamesPlayed ?? 0, wins: p.wins ?? 0, losses: p.losses ?? 0 })
                    : t('noGames')}
                </span>
              </Link>
            ))}
      </div>
    </>
  )
}

function Stat({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div style={{
      flex: 1, background: BG_CARD, padding: '10px 6px', textAlign: 'center',
      clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
    }}>
      <div style={{
        fontSize: 16, fontWeight: 800, color: accent ?? '#E2E8F0',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
        {sub && <span style={{ fontSize: 10, color: MUTED, marginLeft: 4 }}>{sub}</span>}
      </div>
      <div style={{
        fontSize: 8, fontWeight: 700, color: MUTED, marginTop: 3,
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>{label}</div>
    </div>
  )
}

/**
 * One tie: both franchises named, then a row per court.
 *
 * This is the part that could not reuse the SNP TeamFixtures, which never
 * renders an opponent at all — it is a record of one club's own results,
 * which is right when only one club is tracked and wrong here, where both
 * sides are our own teams.
 */
function TieCard({ tie, opponent, eventLabel, roster, format, t }: {
  tie: TieView
  opponent: string
  eventLabel: string
  roster: PplTeamPageData['roster']
  format: ReturnType<typeof useFormatter>
  t: ReturnType<typeof useTranslations>
}) {
  const nameById = new Map(roster.map((p) => [p.playerId, p.displayName?.trim() || p.name]))
  const resultColor = tie.result === 'W' ? GREEN : tie.result === 'L' ? '#FF4655' : MUTED

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}`,
      clipPath: CHUNKY.card, marginBottom: 8, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {[eventLabel, tie.stage].filter(Boolean).join(' · ')}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: MUTED }}>
          {tie.scheduledAt ? format.dateTime(new Date(tie.scheduledAt), DATE_SHORT) : ''}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: '#E2E8F0' }}>
          vs {opponent}
        </span>
        {tie.result
          ? (
            <span style={{ fontSize: 14, fontWeight: 800, color: resultColor, fontVariantNumeric: 'tabular-nums' }}>
              {tie.ourCourts}–{tie.theirCourts}
            </span>
          )
          : (
            <span style={{ fontSize: 9, fontWeight: 800, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {t('upcoming')}
            </span>
          )}
      </div>

      {tie.courts.map((c) => {
        const names = c.ourPlayerIds.map((id) => nameById.get(id)).filter(Boolean).join(' / ')
        return (
        <div key={c.matchId} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 0 6px 8px',
          borderLeft: `2px solid ${c.result === 'W' ? GREEN : c.result === 'L' ? '#FF4655' : BORDER}`,
          marginTop: 4,
        }}>
          {/* No fixed width: the label is one word in English and a much
              longer one in Spanish ("MASCULINO"), and a hard 34px column
              printed it straight through the player names. */}
          <span style={{
            fontSize: 8, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: c.category === 'women' ? WOMEN_PURPLE : MEN_BLUE,
            flexShrink: 0, marginRight: 4,
          }}>
            {c.category ? t(c.category === 'men' ? 'scopeMen' : 'scopeWomen') : ''}
          </span>
          <span style={{
            flex: 1, minWidth: 0, fontSize: 11,
            color: names ? '#CBD5E1' : MUTED,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {/* An upcoming court has no line-up yet — the pairing is named on
                the day. Saying so beats an empty row that reads as missing
                data rather than as a fixture. */}
            {names || t('lineupTbd')}
          </span>
          <span style={{ fontSize: 11, color: MUTED, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {c.sets.map((s) => `${s.ours}-${s.theirs}`).join(' ')}
          </span>
        </div>
        )
      })}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '28px 0', textAlign: 'center', color: MUTED, fontSize: 13 }}>
      {text}
    </div>
  )
}

function Crest({ name, url, color, size }: {
  name: string; url: string | null; color: string; size: number
}) {
  const [err, setErr] = useState(false)
  if (!url || err) {
    const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', background: BG_CARD,
        border: `2px solid ${color}`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: size * 0.3, fontWeight: 800, color, flexShrink: 0,
      }}>{initials}</div>
    )
  }
  return (
    // Plain <img>: crests are on firebasestorage.googleapis.com, which is not
    // in next.config's remotePatterns, and next/image refuses unknown hosts.
    <img
      src={url} alt={name} onError={() => setErr(true)}
      style={{
        width: size, height: size, borderRadius: '50%', objectFit: 'contain',
        background: BG_CARD, border: `2px solid ${color}`, flexShrink: 0,
      }}
    />
  )
}

function PlayerAvatar({ name, url, country }: {
  name: string; url: string | null; country: string | null
}) {
  const [err, setErr] = useState(false)
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <span style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
      {!url || err ? (
        <span style={{
          width: 34, height: 34, borderRadius: '50%', background: BG_CARD,
          border: `1.5px solid ${BORDER}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 11, fontWeight: 700, color: MUTED,
        }}>{initials}</span>
      ) : (
        <img
          src={url} alt={name} onError={() => setErr(true)}
          style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }}
        />
      )}
      {country && (
        <span style={{ position: 'absolute', right: -2, bottom: -2, lineHeight: 0 }}>
          <FlagImage country={country} size={14} />
        </span>
      )}
    </span>
  )
}
