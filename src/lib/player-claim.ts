// src/lib/player-claim.ts
// A regra de quem pode reivindicar qual jogador, isolada da rota.
//
// Está aqui como função pura porque é a única parte do vínculo que merece
// testes de verdade: a rota só monta o contexto e grava. Toda recusa tem um
// código próprio para que a tela possa dizer o que aconteceu — "já é de
// outra conta" e "você já tem um jogador" são problemas diferentes para
// quem está do outro lado.

export type ClaimRejection =
  | 'unauthenticated'
  | 'not_found'
  | 'not_claimable'
  | 'already_claimed'
  | 'account_linked'
  | 'pending'

/** Teto do texto livre do pedido. Curto de propósito: é um recado para o
 *  operador ("sou o Eric, capitão"), não um formulário. */
export const NOTE_MAX_LENGTH = 280

/** Só jogadores amadores podem ser reivindicados. Um pedido para um
 *  profissional não tem upside — só gera fila para recusar. */
export const CLAIMABLE_TIER = 'amateur'

/** O jogador vinculado, como as duas telas o consomem. Mora aqui — e não no
 *  arquivo da rota nem no do hook — porque a rota (servidor) e o hook
 *  (`'use client'`) precisam do mesmo tipo e nenhum dos dois pode importar do
 *  outro sem arrastar junto o que não deve. */
export interface MyPlayerLinked {
  id: string
  name: string
  avatarUrl: string | null
  badgeLabel: string | null
  teamName: string | null
  isCaptain: boolean
}

export interface ClaimContext {
  /** id da sessão, ou null se não houver */
  userId: string | null
  /** o jogador alvo, ou null se o id não existe */
  player: { id: string; tier: string | null } | null
  /** conta que já é dona deste jogador, se houver */
  playerOwnerUserId: string | null
  /** jogador que esta conta já possui, se houver */
  accountPlayerId: string | null
  /** já existe pedido pendente desta conta para este jogador */
  hasPendingClaim: boolean
}

export type ClaimVerdict =
  | { ok: true }
  | { ok: false; reason: ClaimRejection; status: number }

export function evaluateClaim(ctx: ClaimContext): ClaimVerdict {
  // A ordem importa. Identidade primeiro: um visitante anônimo nunca deve
  // descobrir, pela mensagem de erro, quem é dono de qual perfil.
  if (!ctx.userId) return { ok: false, reason: 'unauthenticated', status: 401 }
  if (!ctx.player) return { ok: false, reason: 'not_found', status: 404 }
  if (ctx.player.tier !== CLAIMABLE_TIER) return { ok: false, reason: 'not_claimable', status: 403 }
  if (ctx.playerOwnerUserId) return { ok: false, reason: 'already_claimed', status: 409 }
  if (ctx.accountPlayerId) return { ok: false, reason: 'account_linked', status: 409 }
  if (ctx.hasPendingClaim) return { ok: false, reason: 'pending', status: 409 }
  return { ok: true }
}
