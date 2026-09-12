'use client'
// src/hooks/useMyPlayer.ts
// Estado do vínculo da conta com um jogador, compartilhado entre o /profile
// e o menu do avatar.
//
// O cache de módulo existe porque os dois montam juntos quando o usuário
// abre o menu estando no /profile: sem ele seriam duas chamadas idênticas na
// mesma renderização. Invalida no logout, via mudança do user.id.

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import type { MyPlayerLinked } from '@/lib/player-claim'

export type { MyPlayerLinked }

export type MyPlayerState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'pending'; playerName: string | null }
  | { status: 'linked'; player: MyPlayerLinked }

type Cached = Exclude<MyPlayerState, { status: 'loading' }>

let cacheUserId: string | null = null
let cacheValue: Cached | null = null
let inFlight: Promise<Cached> | null = null
// Incrementado por invalidateMyPlayer. Uma requisição em voo captura o valor
// vigente no momento em que foi disparada; se ele mudar antes dela resolver,
// a resposta chegou tarde demais e não deve reviver o cache invalidado.
let generation = 0

/** Guarda mínima de formato: a rota é nossa e tipada, mas um payload
 *  inesperado (erro 500 com corpo HTML, proxy devolvendo outra coisa) não
 *  deve virar um `undefined.status` na tela — cai em 'none' em vez de
 *  quebrar os componentes que destructuram o resultado. */
function isCached(value: unknown): value is Cached {
  if (!value || typeof value !== 'object') return false
  const status = (value as { status?: unknown }).status
  return status === 'none' || status === 'pending' || status === 'linked'
}

async function load(userId: string): Promise<Cached> {
  if (cacheUserId === userId && cacheValue) return cacheValue
  if (cacheUserId !== userId) { cacheValue = null; inFlight = null; cacheUserId = userId }
  if (!inFlight) {
    const gen = generation
    inFlight = fetch('/api/me/player')
      .then((r): Promise<unknown> | unknown => (r.ok ? r.json() : { status: 'none' }))
      .then((v: unknown): Cached => (isCached(v) ? v : { status: 'none' }))
      .catch((): Cached => ({ status: 'none' }))
      .then((v: Cached) => {
        inFlight = null
        // Se invalidateMyPlayer() rodou enquanto esta requisição estava em
        // voo, a geração mudou: não grava um valor potencialmente
        // pré-invalidação por cima do cache já limpo.
        if (gen === generation) cacheValue = v
        return v
      })
  }
  return inFlight
}

/** Limpa o cache — chame depois de enviar um pedido, para o estado
 *  "pending" aparecer sem recarregar a página. */
export function invalidateMyPlayer() {
  cacheValue = null
  inFlight = null
  generation++
}

// Guarda o valor buscado junto do id de quem o pediu, para não precisar de
// um setState síncrono no corpo do efeito para "resetar" ao trocar de
// usuário — o retorno abaixo simplesmente ignora um valor que não é mais do
// usuário atual, e o efeito só chama setState de dentro do callback
// assíncrono (o padrão que o react-hooks aceita).
type Fetched = { userId: string; value: Cached }

export function useMyPlayer(): MyPlayerState {
  const { user, loading } = useAuth()
  const [fetched, setFetched] = useState<Fetched | null>(null)

  useEffect(() => {
    if (loading || !user) return
    let cancelled = false
    load(user.id).then(v => { if (!cancelled) setFetched({ userId: user.id, value: v }) })
    return () => { cancelled = true }
  }, [user, loading])

  if (loading) return { status: 'loading' }
  if (!user) return { status: 'none' }
  if (fetched && fetched.userId === user.id) return fetched.value
  return { status: 'loading' }
}
