// src/components/road-to-olympics/DecisionMakersDossier.tsx
//
// Six-card grid (3-col on mobile, 6-col on wider). At Soft Launch every
// card renders the initials-fallback avatar — actual photos land when the
// user provides assets under public/road-to-olympics/decision-makers/.

import { useTranslations } from 'next-intl'
import type { DecisionMaker } from '@/types/road-to-olympics'
import { GREEN, BG_CARD, BORDER, MUTED, CHUNKY, SectionTitle } from '@/components/home/shared'

interface Props {
  cards: DecisionMaker[]
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

export default function DecisionMakersDossier({ cards }: Props) {
  const t = useTranslations('roadToOlympics.dossier')
  return (
    <section style={{
      background: BG_CARD,
      border: `1px solid ${BORDER}`,
      clipPath: CHUNKY.card,
      padding: 14,
      marginBottom: 12,
    }}>
      <SectionTitle>{t('title')}</SectionTitle>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 8,
      }}>
        {cards.map((c) => (
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
    </section>
  )
}
