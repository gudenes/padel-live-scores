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
    const thisFlight: Promise<Cached> = fetch('/api/me/player')
      .then((r): Promise<unknown> | unknown => (r.ok ? r.json() : { status: 'none' }))
      .then((v: unknown): Cached => (isCached(v) ? v : { status: 'none' }))
      .catch((): Cached => ({ status: 'none' }))
      .then((v: Cached) => {
        // Só limpa o slot compartilhado se ainda for o dono dele — uma
        // requisição atrasada não pode apagar um `inFlight` mais novo que
        // já assumiu o lugar.
        if (inFlight === thisFlight) inFlight = null
        // E só escreve no cache se ainda for para o mesmo usuário e a
        // mesma geração: entre o disparo e a resolução, invalidateMyPlayer()
        // pode ter rodado (gen muda) ou o usuário pode ter trocado
        // (cacheUserId muda) — nos dois casos esta resposta chegou tarde
        // demais e não deve reviver/contaminar o cache atual.
        if (gen === generation && cacheUserId === userId) cacheValue = v
        return v
      })
    inFlight = thisFlight
  }
  return inFlight
}

/** Descarta o valor em cache. Vale para a PRÓXIMA montagem — não notifica
 *  quem já está montado, porque os deps do efeito são [user, loading]. É o
 *  suficiente para o caso real: quem envia um pedido atualiza a própria
 *  linha com estado local, e o card do /profile é alcançado navegando, o
 *  que monta o componente do zero. Um store com assinantes resolveria o
 *  caso que falta, e esse caso não acontece. */
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

  if (fetched && user && fetched.userId === user.id) return fetched.value
  if (loading) return { status: 'loading' }
  if (!user) return { status: 'none' }
  return { status: 'loading' }
}
