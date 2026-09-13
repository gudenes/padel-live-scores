// src/lib/player-self-edit.ts
// Valida o corpo do PATCH /api/me/player.
//
// Existe como função pura porque a regra que importa aqui é sutil e fácil de
// perder de vista na rota: CAMPO AUSENTE NÃO É CAMPO NULO. Se `racketId`
// ausente virasse `null`, um PATCH que só queria mudar a posição apagaria a
// raquete da pessoa — e o cliente não teria como saber que pediu isso.
//
// A outra razão é negativa: nada que não esteja nesta lista entra. Um corpo
// com `playerId`, `ranking` ou `is_captain` é simplesmente ignorado. A rota
// nunca lê o jogador do request — ele vem da sessão.

// A lista é a fonte da verdade e o tipo deriva dela. Declarar os dois à mão
// deixaria um par que pode divergir em silêncio: um valor novo aceito em
// runtime mas rejeitado pelo compilador, ou o contrário.
const ALLOWED_SIDES = ['drive', 'backhand'] as const

export type PlayerSide = (typeof ALLOWED_SIDES)[number]

/** Só as chaves presentes são aplicadas. `null` limpa; ausente não mexe. */
export interface SelfEditPatch {
  side?: PlayerSide | null
  racketId?: string | null
}

export type SelfEditResult =
  | { ok: true; patch: SelfEditPatch }
  | { ok: false; error: 'bad_side' | 'bad_racket' | 'empty'; status: number }

export function parseSelfEditPayload(body: unknown): SelfEditResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'empty', status: 400 }
  }
  const raw = body as Record<string, unknown>
  const patch: SelfEditPatch = {}

  if ('side' in raw) {
    const v = raw.side
    if (v === null) {
      patch.side = null
    } else if (typeof v === 'string' && (ALLOWED_SIDES as readonly string[]).includes(v)) {
      patch.side = v as PlayerSide
    } else {
      return { ok: false, error: 'bad_side', status: 400 }
    }
  }

  if ('racketId' in raw) {
    const v = raw.racketId
    if (v === null) {
      patch.racketId = null
    } else if (typeof v === 'string' && v.length > 0) {
      patch.racketId = v
    } else {
      return { ok: false, error: 'bad_racket', status: 400 }
    }
  }

  // Um PATCH vazio é bug do cliente, não um no-op silencioso: devolver 200
  // esconderia um formulário que não está mandando o que acha que manda.
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'empty', status: 400 }
  }

  return { ok: true, patch }
}
