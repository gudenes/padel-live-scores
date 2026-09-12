// src/lib/player-equipment.ts
// Decide quais escritas uma troca de raquete exige. Pura de propósito: a
// parte difícil aqui não é falar com o banco, é não sujar o histórico.
//
// `player_equipment` é uma tabela de histórico. A atribuição ativa é a linha
// com `ended_at IS NULL`. Trocar fecha a ativa e abre a nova NO MESMO DIA,
// para o histórico ficar contíguo — sem buraco e sem sobreposição.
//
// O caminho do ops (apps/ops/.../player-equipment/route.ts) faz o mesmo e
// ainda valida datas retroativas, que aqui não existem: o jogador só edita
// "a partir de hoje". A duplicação é deliberada e está registrada no spec.

export interface RacketChangeInput {
  /** Raquete da atribuição ativa, ou null se não houver nenhuma. */
  activeRacketId: string | null
  /** Raquete desejada. null = limpar. */
  nextRacketId: string | null
  /** Data ISO `YYYY-MM-DD`. Recebida como parâmetro para o plano ser testável. */
  today: string
}

export interface RacketChangePlan {
  /** Fechar a atribuição ativa com `ended_at = today`. */
  endActive: boolean
  /** Nova atribuição a inserir, ou null. */
  insert: { racketId: string; startedAt: string } | null
}

export function planRacketChange(input: RacketChangeInput): RacketChangePlan {
  const { activeRacketId, nextRacketId, today } = input

  // Salvar o formulário sem ter mexido na raquete não pode gerar escrita
  // nenhuma. Sem esta guarda, cada salvamento fecharia a atribuição atual e
  // abriria uma idêntica, e o histórico viraria uma linha por clique.
  if (activeRacketId === nextRacketId) {
    return { endActive: false, insert: null }
  }

  return {
    endActive: activeRacketId !== null,
    insert: nextRacketId ? { racketId: nextRacketId, startedAt: today } : null,
  }
}
