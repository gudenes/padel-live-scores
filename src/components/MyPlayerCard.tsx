'use client'
// src/components/MyPlayerCard.tsx
// "Meu perfil de jogador" no /profile.
//
// Fica entre o StatsStrip e Conquistas, acima de Atividade: Atividade é "o que
// eu fiz no app" — ao lado de "Partidas salvas", "quem eu sou" viraria só mais
// um item de lista.
//
// O estado pendente é cinza, sem seta e não clicável de propósito: ele existe
// para responder "e aí, cadê?" sem prometer uma navegação que ainda não existe.

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import Avatar from '@/components/Avatar'
import { useMyPlayer } from '@/hooks/useMyPlayer'

const ORANGE = '#F5A623'
const MUTED = '#6B7280'
const CARD = '#141414'
const CLIP = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export function MyPlayerCard() {
  const t = useTranslations('profile')
  const router = useRouter()
  const mine = useMyPlayer()

  if (mine.status === 'loading' || mine.status === 'none') return null

  if (mine.status === 'pending') {
    return (
      <div style={{
        background: CARD, clipPath: CLIP, borderLeft: `3px solid ${MUTED}`,
        padding: '12px 14px', margin: '0 16px 14px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', background: '#2A2A2A', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: MUTED }}>
            {t('myPlayer')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mine.playerName ?? ''}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{t('myPlayerPending')}</div>
        </div>
      </div>
    )
  }

  const p = mine.player
  return (
    <button
      type="button"
      onClick={() => router.push(`/player/${p.id}` as Parameters<typeof router.push>[0])}
      style={{
        width: 'calc(100% - 32px)', margin: '0 16px 14px', background: CARD, clipPath: CLIP,
        border: 'none', borderLeft: `3px solid ${ORANGE}`, padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
        textAlign: 'left', font: 'inherit', color: 'inherit',
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: '50%', border: `2px solid ${ORANGE}`, overflow: 'hidden', flexShrink: 0 }}>
        <Avatar src={p.avatarUrl} alt="" size={34} fallback={p.name?.[0]} unoptimized />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: MUTED }}>
          {t('myPlayer')}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.name}
        </div>
        {p.badgeLabel && (
          <span style={{
            display: 'inline-block', marginTop: 4, background: '#7ED321', color: '#173404',
            fontSize: 8, fontWeight: 800, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {p.badgeLabel}
          </span>
        )}
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}
