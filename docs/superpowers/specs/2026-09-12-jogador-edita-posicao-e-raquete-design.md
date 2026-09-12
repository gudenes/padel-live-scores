# O jogador vinculado edita a própria posição e raquete

**Data:** 2026-09-12
**Status:** Design — aprovado, pendente plano de implementação
**Branch:** `feat/player-self-edit` (worktree `.worktrees/amateur-profiles`)
**Autor:** brainstorm com o operador (Gustavo)
**Depende de:** [meu perfil de jogador](2026-09-12-meu-perfil-de-jogador-design.md) — em produção desde 2026-09-12

## Problema

O vínculo conta↔jogador entregou identidade, não permissão: quem reivindicou o próprio perfil pode vê-lo e nada mais. Mas há dois campos que **só o jogador sabe** — a posição em que joga e a raquete que usa. Nem o operador, nem a planilha da SNP, nem a FIP têm essa informação.

Os números confirmam: **22 dos 24 amadores estão com `side` vazio**, e só 2 têm raquete registrada.

## Por que a objeção original não vale aqui

Quando desenhamos o vínculo, a decisão foi "só ver", com a justificativa de que o import da SNP reescreve os mesmos campos a cada ciclo e uma edição do jogador sumiria sem explicação.

Isso está errado para estes dois campos, e vale registrar por quê:

- `scripts/import-amateur-season.ts` **não tem nenhum `.update()`**. Ele só faz `.insert()` de jogador novo. `players.side` é gravado uma vez, na criação, e nunca mais.
- A raquete vive em `player_equipment`, tabela que o import não toca.

Nenhum processo automatizado sobrescreve os dois. A objeção era real para nome, ranking e pontos — não para estes.

## O que fica fora, e por quê

| Campo | Por que não |
|---|---|
| Foto | Pública e indexada, sob o nome real de uma pessoa. Upload direto tira a revisão humana de uma superfície que já deu problema uma vez. Se entrar um dia, entra pela fila de aprovação que já existe. |
| Nome / país / nascimento | Alimentam identidade e o `normalized_name` do resolver. |
| Ranking, pontos, capitão | São da planilha e do operador. |

## Arquitetura

### Uma rota escreve: `PATCH /api/me/player`

Corpo: `{ side?: 'drive' | 'backhand' | null, racketId?: string | null }`. Campo ausente = não mexe; `null` explícito = limpa.

**A propriedade de segurança que sustenta a feature: o id do jogador nunca vem do request.** A rota lê `profiles.player_id` a partir da sessão e só toca aquele registro. Não há forma de apontá-la para outra pessoa — nem por engano, nem de propósito. Um corpo malicioso com `playerId` é ignorado porque o campo não existe no contrato.

Recusas:

| Situação | Resposta |
|---|---|
| Sem sessão | `401 unauthenticated` |
| Conta sem `profiles.player_id` | `403 not_linked` |
| `side` fora de `drive`/`backhand`/`null` | `400 bad_side` |
| `racketId` que não existe em `padel_rackets` | `400 bad_racket` |

Se o operador desvincular a conta, o próximo PATCH cai em `403 not_linked`. O vínculo é a permissão; não há uma segunda lista para manter em sincronia.

### Posição

`players.side` é coluna simples. Validar contra os dois valores e gravar.

### Raquete

`player_equipment` é **histórico, não campo**. Trocar de raquete significa:

1. fechar a atribuição ativa (`ended_at = hoje`) — se houver
2. inserir a nova com `started_at = hoje`, `ended_at = null`

Limpar significa só o passo 1.

O ops já implementa isso com validação de datas retroativas (`apps/ops/src/app/api/internal/player-equipment/route.ts`). A rota do usuário faz só o caso "a partir de hoje", que é o único que ele precisa. **Isto duplica um pedaço da lógica do admin** — registrado aqui de propósito, porque é o tipo de divergência que se descobre seis meses depois. A lógica compartilhada mora em `src/lib/player-equipment.ts` para que a duplicação seja uma decisão visível e não um acidente.

### Leitura do catálogo

`padel_rackets` e `padel_brands` têm policy `FOR SELECT USING (true)` — o browser lê direto com o cliente anon. **Nenhuma rota nova de leitura é necessária.**

## A tela

Um botão **Editar** que só aparece quando o perfil aberto é o do próprio usuário (`useMyPlayer()` retorna `linked` e o id bate). Abre uma folha com dois controles:

- **Posição** — três opções: Drive, Revés, e vazio.
- **Raquete** — lista agrupada por marca. São **68 raquetes em 15 marcas**: cabe numa rolagem, sem busca. Uma caixa de busca aqui seria construir para um catálogo que não existe.

Depois de salvar, os dados do perfil recarregam.

A folha é um lugar só, deliberadamente. A alternativa — tornar o widget de posição e o `PlaysWithCard` editáveis no lugar — significa dois componentes que renderizam tanto para o dono quanto para visitantes, com o modo de edição dependendo de quem olha. É exatamente onde bug de permissão nasce.

## Uma decisão consciente de não fazer

**Não há registro de procedência.** Olhando o banco depois, não dá para saber se um `side` veio do operador ou do jogador. Se alguém puser a posição errada, não há como distinguir.

Isso foi avaliado e deixado de fora: são 24 pessoas que o operador conhece, e uma coluna de origem só se paga quando há volume suficiente para você não lembrar. Se a base de amadores crescer para além de um clube, este é o primeiro item a revisitar.

## Testes

- **`src/lib/__tests__/player-self-edit.test.ts`** — a função pura que valida o payload: `side` fora do domínio recusa; campo ausente não vira `null`; `null` explícito limpa. A distinção ausente-vs-nulo é a regra mais fácil de errar aqui, porque um `undefined` tratado como `null` apaga a raquete de quem só queria trocar a posição.
- **`src/lib/__tests__/player-equipment.test.ts`** — a transição de raquete: sem atribuição ativa insere uma; com atribuição ativa fecha a antiga em `hoje` e abre a nova; limpar fecha sem abrir.
- **Rota** — sem sessão 401; conta não vinculada 403; `racketId` inexistente 400 e **nada é gravado** (a validação vem antes de qualquer escrita).
- **Verificação manual em produção** com a conta do operador vinculada a um amador de teste: definir posição, escolher raquete, trocar de raquete e conferir que a anterior ficou com `ended_at` de hoje, limpar, e depois desvincular no admin e confirmar que o botão Editar some.

## Fora de escopo

- Foto, nome, país, nascimento, ranking, pontos, capitão.
- Histórico de raquetes visível para o jogador (o ops já mostra).
- Datas retroativas de troca de raquete.
- Procedência do dado.
- Qualquer edição para jogadores profissionais.
