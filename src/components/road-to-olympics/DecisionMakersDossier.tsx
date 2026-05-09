// src/components/road-to-olympics/DecisionMakersDossier.tsx
//
// Six-card grid split into two sub-sections: Olympic Committee (the deciders)
// and Padel Supporters (the advocates pushing for inclusion).
// At Soft Launch every card renders the initials-fallback avatar — actual
// photos land when the user provides assets under
// public/road-to-olympics/decision-makers/.

import { useTranslations } from 'next-intl'
import type { DecisionMaker } from '@/types/road-to-olympics'
import { GREEN, BG_CARD, BORDER, MUTED, CHUNKY } from '@/components/home/shared-constants'
import { SectionTitle } from '@/components/home/shared'

interface Props {
  cards: DecisionMaker[]
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

const CARD_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 8,
}

function CardGrid({ group }: { group: DecisionMaker[] }) {
  return (
    <div style={CARD_GRID}>
      {group.map((c) => (
        <div key={c.key} style={{
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${BORDER}`,
          clipPath: CHUNKY.card,
          padding: 10,
        }}>
          <div style={{
            width: 28,
            height: 28,
            clipPath: CHUNKY.badge,
            background: 'rgba(126,211,33,0.15)',
            color: GREEN,
            fontSize: 11,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 8,
          }}>
            {initialsFor(c.name)}
          </div>
          <div style={{
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            color: GREEN,
            fontWeight: 700,
            marginBottom: 4,
          }}>
            {c.role}
          </div>
          <div style={{ fontSize: 12, color: '#fff', fontWeight: 700, lineHeight: 1.2 }}>
            {c.name}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
            {c.org}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function DecisionMakersDossier({ cards }: Props) {
  const t = useTranslations('roadToOlympics.dossier')

  const olympicGroup = cards.filter((c) => c.group === 'olympic-committee')
  const padelGroup = cards.filter((c) => c.group === 'padel-advocates')

  return (
    <section style={{
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      clipPath: CHUNKY.card,
      padding: 14,
      marginBottom: 12,
    }}>
      <SectionTitle>{t('title')}</SectionTitle>

      {olympicGroup.length > 0 && (
        <>
          <div style={{
            fontSize: 10,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: MUTED,
            fontWeight: 700,
            marginTop: 0,
            marginBottom: 8,
          }}>
            {t('groupOlympicCommittee')}
          </div>
          <CardGrid group={olympicGroup} />
        </>
      )}

      {padelGroup.length > 0 && (
        <>
          <div style={{
            fontSize: 10,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: MUTED,
            fontWeight: 700,
            marginTop: 12,
            marginBottom: 8,
          }}>
            {t('groupPadelAdvocates')}
          </div>
          <CardGrid group={padelGroup} />
        </>
      )}
    </section>
  )
}
