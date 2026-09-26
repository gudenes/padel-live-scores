'use client'
import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import Avatar from '@/components/Avatar'
import { FlagImage } from '@/components/FlagImage'
import { Link } from '@/i18n/navigation'
import { partitionField, combinedPoints, bestRank, type FieldEntry, type PlayerHydration } from '@/lib/entry-field'
import { LIME, GOLD } from '@/lib/projection-view'
import HeroPhoto from './HeroPhoto'
import { usePairImages } from './usePairImages'

const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const SECONDARY = '#9AAEC4'
const CARD = 'rgba(255,255,255,0.03)'
const CHUNK_CARD = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'
const BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const MONO = 'ui-monospace, "SF Mono", monospace'

function surnames(entry: FieldEntry): string {
  return [entry.player1_name, entry.player2_name]
    .filter(Boolean)
    .map((n) => (n as string).split(' ').slice(-1)[0] || (n as string))
    .join(' / ')
}

function EntryRow({ entry, playerMap, rank, onPick }: {
  entry: FieldEntry
  playerMap: Record<string, PlayerHydration>
  rank: number | null
  onPick: () => void
}) {
  const t = useTranslations('projectionTab')
  const format = useFormatter()
  const p1 = entry.player1_id ? playerMap[entry.player1_id] : undefined
  const p2 = entry.player2_id ? playerMap[entry.player2_id] : undefined
  const points = combinedPoints(entry)
  const ring = { border: '2px solid var(--bg-card)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
  return (
    <div
      role="button"
      tabIndex={0}
      className="pn-field-row"
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick() } }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: CARD, border: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px', clipPath: CHUNK_CARD, marginBottom: 6 }}
    >
      {rank != null && (
        <span style={{ fontFamily: MONO, fontSize: 17, fontWeight: 900, color: GOLD, flexShrink: 0, minWidth: 18 }}>{rank}</span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <Avatar src={p1?.avatar_url ?? null} alt={entry.player1_name ?? ''} size={30} fallback={entry.player1_name?.[0]} unoptimized style={ring} />
        </div>
        <div style={{ position: 'relative', zIndex: 1, marginLeft: -9 }}>
          <Avatar src={p2?.avatar_url ?? null} alt={entry.player2_name ?? ''} size={30} fallback={entry.player2_name?.[0]} unoptimized style={ring} />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: TEXT, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{surnames(entry)}</div>
        <div style={{ color: SECONDARY, fontSize: 10, fontWeight: 600, marginTop: 1 }}>
          {[p1?.ranking, p2?.ranking].filter((r) => r != null).map((r) => `#${r}`).join(' · ') || ' '}
        </div>
      </div>
      {points != null && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, color: TEXT, lineHeight: 1 }}>{format.number(points)}</div>
          <div style={{ color: MUTED, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>{t('fieldPoints')}</div>
        </div>
      )}
    </div>
  )
}

const SECTION_LABEL: CSSProperties = {
  color: SECONDARY, fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
  letterSpacing: 0.8, margin: '2px 0 8px 2px',
}

export default function FieldView({ entries, playerMap, loading, error }: {
  entries: FieldEntry[]
  playerMap: Record<string, PlayerHydration>
  loading: boolean
  error: boolean
}) {
  const t = useTranslations('projectionTab')
  const format = useFormatter()
  const [selected, setSelected] = useState<string | null>(null)

  const { seeded, unseeded } = useMemo(() => partitionField(entries), [entries])
  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selected) ?? null,
    [entries, selected],
  )
  // Full-body photos for the hero banner. Only the selected pair is fetched.
  const heroIds = useMemo(
    () => (selectedEntry ? [selectedEntry.player1_id, selectedEntry.player2_id].filter(Boolean) as string[] : []),
    [selectedEntry],
  )
  const heroImages = usePairImages(heroIds)

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>…</div>
  }

  if (error) {
    return <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>{t('fieldError')}</div>
  }

  if (entries.length === 0) {
    return <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>{t('fieldEmpty')}</div>
  }

  if (selectedEntry) {
    const players = [
      { id: selectedEntry.player1_id, name: selectedEntry.player1_name, country: selectedEntry.player1_country },
      { id: selectedEntry.player2_id, name: selectedEntry.player2_name, country: selectedEntry.player2_country },
    ].filter((p) => p.name)
    const points = combinedPoints(selectedEntry)
    const rank = bestRank(selectedEntry, playerMap)
    return (
      <div key={`field-detail-${selected}`} className="projection-cascade" style={{ padding: '14px 13px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 0 10px 2px' }}>
          <button onClick={() => setSelected(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: SECONDARY, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, padding: 0 }}>
            ‹ {t('back')}
          </button>
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', minHeight: 130, overflow: 'hidden', marginBottom: 16, background: 'linear-gradient(135deg, #0d0d0d 0%, #1e1e1e 58%, #131313 100%)', border: '1px solid rgba(255,255,255,0.08)', clipPath: 'polygon(0 7%, 99% 0, 100% 93%, 1% 100%)' }}>
          <div style={{ position: 'absolute', left: 30, top: '50%', width: 175, height: 175, transform: 'translateY(-50%)', background: 'radial-gradient(circle, rgba(126,211,33,0.22), transparent 68%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, width: 122, flexShrink: 0, display: 'flex', alignItems: 'flex-end' }}>
            {players.map((p, i) => {
              const img = p.id ? heroImages.get(p.id) : undefined
              const avatar = (p.id ? playerMap[p.id]?.avatar_url : null) ?? img?.avatarUrl ?? null
              if (!p.id) {
                // Unresolved player: no id means no HeroPhoto (it links to /player/<id>).
                // Render the same fallback slot HeroPhoto uses for a missing photo, so
                // the banner stays two-photos-wide instead of lopsided.
                return (
                  <div key={p.name} style={{ height: 130, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 12, marginLeft: i > 0 ? -38 : 0 }}>
                    <Avatar src={null} alt={p.name as string} size={82} fallback={p.name?.[0]} unoptimized style={{ border: '2px solid rgba(255,255,255,0.12)' }} />
                  </div>
                )
              }
              return <HeroPhoto key={p.id} id={p.id} name={p.name as string} photoUrl={img?.photoUrl ?? null} avatarUrl={avatar} overlap={i > 0} />
            })}
          </div>
          <div style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0, padding: '12px 11px 12px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 7 }}>
            {selectedEntry.seed != null && (
              <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 900, color: TEXT, lineHeight: 0.9 }}>#{selectedEntry.seed}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: selectedEntry.seed != null ? 4 : 0 }}>
              {players.map((p) => {
                const body = (
                  <>
                    <FlagImage country={p.country} size={21} style={{ clipPath: BADGE, boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }} />
                    <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{p.name}</span>
                  </>
                )
                const style = { display: 'flex', alignItems: 'center', gap: 9, color: TEXT, textDecoration: 'none', minWidth: 0 } as const
                return p.id
                  ? <Link key={p.id} href={`/player/${p.id}`} style={style}>{body}</Link>
                  : <div key={p.name} style={style}>{body}</div>
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1, background: CARD, border: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px', clipPath: CHUNK_CARD }}>
            <div style={{ color: MUTED, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('fieldCombined')}</div>
            <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 900, color: TEXT, marginTop: 2 }}>{points != null ? format.number(points) : '—'}</div>
          </div>
          <div style={{ flex: 1, background: CARD, border: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px', clipPath: CHUNK_CARD }}>
            <div style={{ color: MUTED, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('fieldBestRank')}</div>
            <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 900, color: TEXT, marginTop: 2 }}>{rank != null ? `#${rank}` : '—'}</div>
          </div>
        </div>

        <div style={SECTION_LABEL}>{t('projectedPath')}</div>
        <div style={{ background: CARD, border: '1px dashed rgba(255,255,255,0.18)', padding: '26px 16px', textAlign: 'center' }}>
          <div style={{ color: GOLD, fontSize: 22, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">🔒</div>
          <div style={{ color: TEXT, fontSize: 14, fontWeight: 800, marginBottom: 5 }}>{t('fieldPathLocked')}</div>
          <div style={{ color: SECONDARY, fontSize: 11.5, lineHeight: 1.5, maxWidth: 260, margin: '0 auto' }}>{t('fieldPathLockedBody')}</div>
        </div>

        <div style={{ marginTop: 16, textAlign: 'center', color: MUTED, fontSize: 9, fontWeight: 600 }}>{t('modelEstimate')}</div>
      </div>
    )
  }

  return (
    <div key="field-list" className="page-mount-anim" style={{ padding: '14px 13px 24px' }}>
      <div style={{ color: TEXT, fontSize: 17, fontWeight: 800, letterSpacing: 0.2 }}>{t('fieldTitle')}</div>
      <div style={{ color: SECONDARY, fontSize: 12, fontWeight: 600, marginTop: 2 }}>{t('fieldSubtitle', { count: entries.length })}</div>

      <div style={{ margin: '12px 0 16px', background: 'rgba(126,211,33,0.07)', border: '1px solid rgba(126,211,33,0.22)', padding: '9px 11px', clipPath: CHUNK_CARD }}>
        <span style={{ color: LIME, fontSize: 11, fontWeight: 800 }}>{t('fieldOddsNote')}</span>{' '}
        <span style={{ color: SECONDARY, fontSize: 11, fontWeight: 600, lineHeight: 1.5 }}>{t('fieldOddsNoteBody')}</span>
      </div>

      {seeded.length > 0 && (
        <>
          <div style={SECTION_LABEL}>{t('fieldSeeded')}</div>
          {seeded.map((e) => (
            <EntryRow key={e.id} entry={e} playerMap={playerMap} rank={e.seed} onPick={() => setSelected(e.id)} />
          ))}
        </>
      )}

      {unseeded.length > 0 && (
        <>
          <div style={{ ...SECTION_LABEL, marginTop: 18 }}>{t('fieldUnseeded')} · {unseeded.length}</div>
          {unseeded.map((e) => (
            <EntryRow key={e.id} entry={e} playerMap={playerMap} rank={null} onPick={() => setSelected(e.id)} />
          ))}
        </>
      )}
    </div>
  )
}
