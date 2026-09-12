# Meu perfil de jogador — ligar a conta logada a um jogador

**Data:** 2026-09-12
**Status:** Design — aprovado, pendente plano de implementação
**Branch:** `feat/amateur-admin-v2` (worktree `.worktrees/amateur-profiles`)
**Autor:** brainstorm com o operador (Gustavo)

## Problema

Os 24 jogadores do Blue Padel têm perfil no PadelNachos. Alguns deles também têm conta. Hoje essas duas coisas não se conhecem: o jogador entra, vê a própria tela de perfil de usuário — XP, medalhas, sequência de dias — e não há nada ligando aquilo ao `/player/<id>` que mostra os jogos dele.

O objetivo é um atalho: **"meu perfil de jogador"**.

## O que isto realmente é

Parece um link, mas é uma afirmação de identidade: *esta conta é esta pessoa*. E a tabela `players` guarda os 24 amadores **junto com os profissionais**. Um vínculo sem controle deixa qualquer fã virar o Tapia, e deixa um colega de equipe virar outro colega.

O que impede isso não é uma regra de tela. É alguém confirmar — e esse alguém é o operador, que conhece os jogadores do próprio clube.

O projeto já tem exatamente essa forma: `/api/player/[id]/suggest` grava em `player_suggestions`, e o admin revisa e aplica. O vínculo entra pelo mesmo caminho, com a mesma vizinhança no admin.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Como o vínculo nasce | Pedido do usuário + aprovação no admin | Escala sem o operador caçar UUID, e a aprovação **é** a verificação |
| Quem pode ser reivindicado | Só `players.tier = 'amateur'` | Um pedido para o Tapia não tem upside, só fila para recusar |
| O que o vínculo dá | **Só ver** | Identidade, não permissão. Edição continua pelo botão de sugestão |
| Onde o vínculo mora | Coluna em `profiles` | É a pergunta "quem é este usuário?", feita a cada carregamento |
| Descoberta | No `/player/<id>`, não no `/profile` | 129 contas, 24 jogadores — um convite permanente seria ruído para a maioria |

### Por que "só ver"

Edição direta soa natural — é o perfil dele. Mas os mesmos campos vêm da planilha da SNP e são reescritos a cada import: uma edição do jogador sumiria no próximo ciclo sem explicação para ninguém. A foto, o campo que ele mais vai querer trocar, é justamente o mais público e o mais indexado.

Com "só ver", o botão de sugestão que já existe continua sendo o caminho — só que agora o operador sabe de quem veio, e pode aprovar sem investigar.

## Parte 1 — Schema

Duas coisas distintas. Misturá-las é o erro fácil.

**`player_claims`** é a fila. Espelha `player_suggestions` de perto, inclusive no RLS deny-by-default:

```sql
CREATE TABLE IF NOT EXISTS player_claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_name   TEXT,                 -- snapshot no momento do pedido
  user_id       UUID NOT NULL,        -- profiles.id / users.id (sem FK, como player_suggestions)
  user_email    TEXT,                 -- o que o operador lê para decidir
  note          TEXT,                 -- "sou o Eric, capitão do Blue Padel"
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_claims_pending
  ON player_claims (created_at DESC) WHERE status = 'pending';

-- Um pedido pendente por conta e jogador. Sem isto, tocar duas vezes no
-- botão gera duas linhas idênticas na fila do operador.
CREATE UNIQUE INDEX IF NOT EXISTS player_claims_pending_uk
  ON player_claims (user_id, player_id) WHERE status = 'pending';

ALTER TABLE player_claims ENABLE ROW LEVEL SECURITY;
```

**`profiles.player_id`** é o vínculo:

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS player_id UUID REFERENCES players(id) ON DELETE SET NULL;

-- A restrição que mais importa: um jogador pertence a no máximo uma conta.
-- Sem ela, dois pedidos aprovados por distração deixam duas contas donas do Eric,
-- e nada no sistema reclama.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_player_id_uk
  ON profiles (player_id) WHERE player_id IS NOT NULL;

COMMENT ON COLUMN profiles.player_id IS
  'Jogador vinculado a esta conta, aprovado via player_claims. NULL = conta sem perfil de jogador.';
```

Uma conta tem no máximo um jogador (é a coluna), e um jogador tem no máximo uma conta (é o índice único). As duas direções ficam fechadas no banco, não na aplicação.

## Parte 2 — O pedido

**Rota:** `POST /api/player/[id]/claim`

Recusa, nesta ordem, com código próprio para cada caso:

| Situação | Resposta |
|---|---|
| Sem sessão | `401 unauthenticated` |
| Jogador não existe | `404 not_found` |
| `players.tier != 'amateur'` | `403 not_claimable` |
| Jogador já vinculado a alguma conta | `409 already_claimed` |
| Conta já vinculada a outro jogador | `409 account_linked` |
| Já existe pedido pendente desta conta para este jogador | `409 pending` |

Login obrigatório: um pedido anônimo não daria ao operador nada para julgar. Isso já limita abuso melhor que rate-limit por IP — por isso a rota **não** replica o contador de 5/dia do `suggest`; a barreira aqui é ter conta, e o índice único impede a duplicata. `note` é opcional, com teto de comprimento.

**Onde fica o botão na tela:** uma linha discreta no fim da aba Resumo do perfil amador, junto do "sugerir correção" — a mesma família de ação. **Não vai no hero.** Aquela faixa já brigou por largura duas vezes: o botão de share truncou o nome do Tapia, e a insígnia de capitão truncou "Eric Ortega".

O botão só aparece para usuário logado, em jogador amador ainda não vinculado. Depois de enviar, vira "pedido em análise" na mesma linha. Se o usuário já é o dono, vira uma marca silenciosa de que é ele.

## Parte 3 — A aprovação

Seção nova no admin, irmã de Player Suggestions: pendentes primeiro, **Aprovar** / **Recusar** / **Desvincular**.

**A linha mostra o e-mail da conta em destaque.** É a única evidência que o operador tem. Aprovar é dizer "sim, este endereço é o Eric" — sem o e-mail na frente, ele estaria carimbando um UUID. Dentro de um clube o risco real não é um estranho; é um colega pedir o perfil de outro colega, e o que barra isso é reconhecer o endereço.

Aprovar grava `profiles.player_id` e vira o status. Se o jogador tiver sido vinculado entre o carregamento da lista e o clique, a gravação bate no índice único e a tela diz isso — em vez de sobrescrever silenciosamente. Recusar só vira o status, com `review_note` opcional.

**Desvincular** limpa `profiles.player_id` e marca a claim aprovada como `rejected` com nota. Vai acontecer — pessoa sai do clube, vínculo errado — e sem esse botão vira chamado no SQL.

Rotas em `apps/ops`, no padrão de `/api/internal/player-suggestions`: sessão Auth.js com `isOperator`, service-role client.

## Parte 4 — A tela do usuário

Dois pontos de entrada, ambos só quando existe vínculo:

**`/profile`** — card entre o StatsStrip e Conquistas, com avatar do jogador, nome, insígnia AMADOR · SNP, capitão quando for o caso, e seta para `/player/<id>`. Fica acima de Atividade de propósito: Atividade é "o que eu fiz no app"; ao lado de "Partidas salvas", "quem eu sou" viraria mais um item de lista.

No estado pendente o card aparece **cinza, sem seta, não clicável** — só para responder "e aí, cadê?" sem o usuário ter que perguntar. Com cor e seta ele prometeria uma navegação que ainda não existe.

**`ProfileMenu`** (o dropdown do avatar no header) — linha logo abaixo do card da conta, acima de Notificações. O card é "sua conta", a linha é "seu jogador"; as duas identidades ficam juntas, e abaixo começa a lista de funções. O ícone é a **foto do jogador**, não um SVG verde como as outras linhas — é o que separa quem eu sou do que eu faço.

O estado pendente **não** aparece no menu: menu é lista de destinos, e uma linha morta num dropdown é pior que linha nenhuma.

Risco conhecido: se a foto da conta e a do jogador forem a mesma, as duas linhas ficam parecidas a ponto de parecerem duplicata. O que as separa é a insígnia AMADOR · SNP, que o card da conta nunca tem. Se na prática confundir, o ajuste é trocar o avatar da linha por um ícone de raquete — decisão a tomar vendo, não agora.

Textos nos 5 locales (`en`, `es`, `pt`, `it`, `fr`).

## Testes

**`src/lib/__tests__/player-claim.test.ts`** — a função pura que decide se um pedido é aceitável, dada a sessão, o jogador e o estado atual. Cada linha da tabela de recusas vira um caso. É onde a regra mora; a rota só a chama.

**Rota** — pedido válido grava `pending`; segundo pedido idêntico devolve `409 pending` (prova o índice único parcial); jogador profissional devolve `403`.

**Aprovação** — grava `profiles.player_id`; aprovar um jogador já vinculado a outra conta **falha** e não sobrescreve. Este é o teste que justifica o índice único existir; sem ele a proteção é só intenção.

**Verificação manual** com build de produção: pedir com uma conta de teste, aprovar no admin, conferir o card no `/profile` e a linha no menu, desvincular e conferir que as duas somem.

## Fora de escopo

- Push de "seu pedido foi aprovado" — a linha simplesmente aparece.
- Jogadores profissionais.
- Mais de um jogador por conta.
- Qualquer permissão de escrita para o jogador vinculado.
- Vincular contas a equipes (capitão administrando o plantel).
