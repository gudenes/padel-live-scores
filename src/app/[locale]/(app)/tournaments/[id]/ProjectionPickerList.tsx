'use client'
import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import Avatar from '@/components/Avatar'
import type { ProjectionRow } from '@/lib/projection-types'
import { orderPickerPairs, type OrderedPicker } from '@/lib/projection-picker'

const CARD = 'rgba(255,255,255,0.03)'
const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const GOLD = '#F5A623'
const LIVE = '#FF4655'
const CHUNK = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'
const BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const MONO = 'ui-monospace, "SF Mono", monospace'

export interface ResolvedPlayer { name: string; country: string | null; avatarUrl: string | null; photoUrl: string | null }

function lastName(name: string): string {
  return name.split(' ').slice(-1)[0] || name
}
function champColor(p: number): string {
  return p >= 0.2 ? LIME : p >= 0.08 ? GOLD : SECONDARY
}

export default function ProjectionPickerList({
  rows,
  seedByPair,
  resolvePlayer,
  onPick,
}: {
  rows: ProjectionRow[]
  seedByPair: Map<string, number>
  resolvePlayer: (id: string) => ResolvedPlayer
  onPick: (pairKey: string) => void
}) {
  const t = useTranslations('projectionTab')
  const ordered: OrderedPicker = useMemo(() => orderPickerPairs(rows, seedByPair), [rows, seedByPair])

  const names = (r: ProjectionRow) => r.pair_player_ids.map((id) => lastName(resolvePlayer(id).name)).join(' / ')
  const seedOf = (r: ProjectionRow) => seedByPair.get(r.pair_key) ?? null

  return (
    <div>
      <div style={{ color: TEXT, fontSize: 14, fontWeight: 800 }}>{t('pickAPair')}</div>
      <div style={{ color: SECONDARY, fontSize: 11, marginTop: 2, marginBottom: 14 }}>{t('pickHint')}</div>

      {ordered.feature.length > 0 && (
        <>
          <div style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, margin: '0 0 8px 2px' }}>{t('topSeeds')}</div>
          {ordered.feature.map((r, i) => {
            const [id1, id2] = r.pair_player_ids
            const p1 = resolvePlayer(id1); const p2 = resolvePlayer(id2)
            const lead = i === 0
            return (
              <button key={r.pair_key} onClick={() => onPick(r.pair_key)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: lead ? 'linear-gradient(90deg, rgba(126,211,33,0.10), rgba(255,255,255,0.03))' : CARD,
                  border: `1px solid ${lead ? 'rgba(126,211,33,0.22)' : 'rgba(255,255,255,0.07)'}`,
                  padding: '8px 12px 8px 8px', marginBottom: 8, clipPath: CHUNK }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', flexShrink: 0 }}>
                  <FeaturePhoto p={p1} />
                  <div style={{ marginLeft: -14, borderLeft: '2px solid #1A1A1A', borderRadius: 8 }}><FeaturePhoto p={p2} /></div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {seedOf(r) != null && <span style={{ background: 'rgba(255,255,255,0.1)', color: TEXT, fontSize: 9, fontWeight: 800, padding: '1px 6px', clipPath: BADGE }}>{seedOf(r)}</span>}
                    <span style={{ color: MUTED, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{t('seed')}</span>
                  </div>
                  <div style={{ color: TEXT, fontSize: 14, fontWeight: 800, marginTop: 3 }}>{names(r)}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ color: champColor(r.champion_prob), fontSize: 22, fontWeight: 800, lineHeight: 1, fontFamily: MONO }}>{Math.round(r.champion_prob * 100)}%</div>
                  <div style={{ color: MUTED, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 }}>{t('champion')}</div>
                </div>
                <div style={{ color: '#4A6F8E', fontSize: 16 }}>›</div>
              </button>
            )
          })}
        </>
      )}

      {ordered.rest.length > 0 && (
        <div style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, margin: '6px 0 8px 2px' }}>{t('allPairs')}</div>
      )}
      {ordered.rest.map((r) => <CompactRow key={r.pair_key} r={r} names={names(r)} seed={seedOf(r)} resolvePlayer={resolvePlayer} onPick={onPick} />)}
      {ordered.eliminated.map((r) => <CompactRow key={r.pair_key} r={r} names={names(r)} seed={seedOf(r)} resolvePlayer={resolvePlayer} onPick={onPick} eliminated />)}
    </div>
  )
}

function FeaturePhoto({ p }: { p: ResolvedPlayer }) {
  const src = p.photoUrl ?? p.avatarUrl
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={p.name} style={{ width: 48, height: 60, objectFit: 'cover', objectPosition: 'top', borderRadius: 8, background: '#222' }} />
  }
  return <div style={{ width: 48, height: 60, borderRadius: 8, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontWeight: 800 }}>{p.name?.[0] ?? '?'}</div>
}

function CompactRow({ r, names, seed, resolvePlayer, onPick, eliminated }: {
  r: ProjectionRow; names: string; seed: number | null
  resolvePlayer: (id: string) => ResolvedPlayer; onPick: (k: string) => void; eliminated?: boolean
}) {
  const t = useTranslations('projectionTab')
  const [id1, id2] = r.pair_player_ids
  const p1 = resolvePlayer(id1); const p2 = resolvePlayer(id2)
  const grey = eliminated ? { filter: 'grayscale(1)' as const } : {}
  return (
    <button onClick={() => onPick(r.pair_key)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
        background: eliminated ? 'rgba(255,255,255,0.02)' : CARD, border: '1px solid rgba(255,255,255,0.06)',
        padding: '8px 12px', marginBottom: 6, clipPath: CHUNK, opacity: eliminated ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <Avatar src={p1.avatarUrl} alt={p1.name} size={28} fallback={p1.name?.[0]} unoptimized style={{ border: '2px solid var(--bg-card)', ...grey }} />
        <div style={{ marginLeft: -9 }}><Avatar src={p2.avatarUrl} alt={p2.name} size={28} fallback={p2.name?.[0]} unoptimized style={{ border: '2px solid var(--bg-card)', ...grey }} /></div>
      </div>
      <div style={{ flex: 1, color: TEXT, fontSize: 13, fontWeight: 600 }}>
        {names}{seed != null && <span style={{ color: MUTED, fontSize: 9, fontWeight: 700, marginLeft: 6 }}>[{seed}]</span>}
      </div>
      {eliminated
        ? <div style={{ color: LIVE, fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{t('out')}{r.eliminated_round ? ` · ${r.eliminated_round}` : ''}</div>
        : <div style={{ color: champColor(r.champion_prob), fontSize: 14, fontWeight: 800, fontFamily: MONO }}>{Math.round(r.champion_prob * 100)}%</div>}
      <div style={{ color: '#4A6F8E', fontSize: 15 }}>›</div>
    </button>
  )
}
