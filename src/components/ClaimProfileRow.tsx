'use client'
// src/components/ClaimProfileRow.tsx
// "Sou eu" na aba Resumo do perfil amador.
//
// Fica junto de "sugerir correção" — mesma família de ação — e deliberadamente
// FORA do hero: aquela faixa já truncou o nome do Tapia por causa do botão de
// share e "Eric Ortega" por causa da insígnia de capitão.
//
// Só aparece para usuário logado, em jogador ainda não vinculado. Quem não é
// jogador nunca esbarra nisso: não há convite no /profile.

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/components/AuthProvider'
import { useMyPlayer, invalidateMyPlayer } from '@/hooks/useMyPlayer'

const ORANGE = '#F5A623'
const MUTED = '#8A8A8A'
const GREEN = '#7ED321'
const RED = '#FF4655'

export function ClaimProfileRow({ playerId }: { playerId: string }) {
  const t = useTranslations('amateur')
  const { user } = useAuth()
  const mine = useMyPlayer()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  // Sem sessão não há o que reivindicar, e um convite para "entre e reivindique"
  // seria ruído num perfil que a maioria das visitas nunca vai reivindicar.
  if (!user) return null
  if (mine.status === 'loading') return null
  if (mine.status === 'linked' && mine.player.id !== playerId) return null
  if (mine.status === 'linked') {
    return <Row><span style={{ color: GREEN }}>{t('claimYours')}</span></Row>
  }
  if (mine.status === 'pending' || sent) {
    return <Row><span>{t('claimPending')}</span></Row>
  }

  const submit = async () => {
    setSending(true)
    setFailed(false)
    const res = await fetch(`/api/player/${playerId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null)
    setSending(false)
    // Só o 409 "pending" é sucesso do ponto de vista de quem clicou: o pedido
    // caiu numa corrida entre dois cliques e já está na fila. "already_claimed"
    // e "account_linked" também vêm como 409, mas NÃO são sucesso — dizer
    // "pedido em análise" ali seria mentira que o usuário age em cima. Por
    // isso o corpo precisa ser lido e o `error` conferido, não só o status.
    if (res && res.ok) {
      invalidateMyPlayer()
      setSent(true)
      return
    }
    if (res && res.status === 409) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      if (body?.error === 'pending') {
        invalidateMyPlayer()
        setSent(true)
        return
      }
    }
    setFailed(true)
  }

  return (
    <Row>
      <span>{t('claimPrompt')}{' '}
        <button
          onClick={submit}
          disabled={sending}
          style={{ background: 'none', border: 'none', padding: 0, color: ORANGE, font: 'inherit', cursor: 'pointer' }}
        >
          {t('claimCta')}
        </button>
      </span>
      {failed && <span style={{ color: RED, marginLeft: 6 }}>{t('claimFailed')}</span>}
    </Row>
  )
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div style={{
      gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8,
      border: '1px dashed #2A2A2A', padding: '9px 10px', fontSize: 10, color: MUTED,
    }}>
      {children}
    </div>
  )
}
