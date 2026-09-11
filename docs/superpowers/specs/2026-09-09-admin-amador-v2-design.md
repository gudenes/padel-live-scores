# Admin de amadores v2 — foto, rótulo curto e múltiplas temporadas

**Data:** 2026-09-09
**Status:** Design — aprovado, pendente plano de implementação
**Branch:** `feat/amateur-admin-v2` (worktree `.worktrees/amateur-profiles`)
**Autor:** brainstorm com o operador (Gustavo)

## Problema

Os perfis amadores existem e estão em produção ([spec v1](2026-09-09-perfil-amador-e-equipes-design.md), PR #602). Ao usá-los de verdade, três lacunas apareceram:

1. **Todos os 24 jogadores são um círculo com a inicial.** Não há como subir uma foto — `players.avatar_url` é editável por API, mas nenhuma tela do admin oferece upload.
2. **O selo verde do hero quebra em duas linhas** e empurra o nome pra baixo. Ele monta `"AMATEUR · SERIES NACIONALES DE PÁDEL"` a partir de `teams.competition`, que é longo demais pra um chip. O widget de pontos sofre do mesmo mal: `"PUNTOS SERIES NACIONALES DE PÁDEL"`.
3. **O perfil só enxerga uma temporada.** `fetchAmateurProfile` carrega o vínculo mais recente do jogador e ignora o resto. Com a 26/27 entrando, a 25/26 simplesmente sumiria.

O que **não** é problema e não entra aqui: lado, data de nascimento, país, nome, altura, mão e raquete já são editáveis no admin hoje, na seção Profile e na aba Equipment do perfil do jogador. A bandeira do país já está codificada no hero — ela não aparece porque `players.country` está vazio, não porque falte código.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Texto do selo | Literal, vindo do banco, igual em todos os idiomas | Escolha do operador; simplifica e evita "Amateur"/"Amador"/"Amatoriale" divergindo |
| Escopo do upload | Apenas `tier='amateur'` | `source-priority` dá `avatar_url` à padelapi; foto de amador não tem sync competindo |
| Múltiplas temporadas | Abre na mais recente, com seletor | Espelha o seletor de ano do perfil profissional |

## Parte 1 — Rótulo curto da competição

### Schema

```sql
alter table public.teams
  add column if not exists badge_label text,
  add column if not exists short_name  text;
```

Duas colunas porque são dois usos distintos:

- **`badge_label`** — o selo verde do hero imprime este texto **literal**, sem compor com i18n. Para o Blue Padel: `'Amador · SNP'`.
- **`short_name`** — referência compacta à competição usada onde hoje se imprime o nome longo: o label do widget de pontos e o chip de ranking. Para o Blue Padel: `'SNP'`.

Ambas nullable. Quando `badge_label` é nulo, o selo cai no comportamento atual (`{t('amateur.badge')} · {primeiro segmento de competition}`); quando `short_name` é nulo, os labels caem em `competition`. Uma equipe futura importada sem rótulo continua funcionando sem ajuste.

A chave i18n `amateur.badge` **permanece** — ela é o fallback, não vira código morto.

### UI

Em [`AmateurProfile.tsx`](../../../src/app/[locale]/player/[id]/AmateurProfile.tsx):

- Linha 161 (selo): usa `data.team.badge_label` quando presente.
- Linha 88 (chip de ranking) e o widget de pontos em `SummaryTab.tsx`: usam `short_name` quando presente, no lugar do `competitionShort` derivado por `split('·')`.

O `competitionShort` derivado permanece como fallback e some do caminho principal.

### Preenchimento

Via SQL direto, uma vez, junto da migração — não há tela de CRUD de equipes e não vamos construir uma aqui:

```sql
update public.teams
   set badge_label = 'Amador · SNP', short_name = 'SNP'
 where slug = 'blue-padel-mataro';
```

## Parte 2 — Upload de foto (amadores)

### Rota

Nova: `apps/ops/src/app/api/internal/upload-player-avatar/route.ts`, modelada em [`upload-equipment-image`](../../../apps/ops/src/app/api/internal/upload-equipment-image/route.ts).

- **Auth:** sessão Auth.js com `isOperator`, igual às demais rotas `/api/internal/*`.
- **Entrada:** `multipart/form-data` com `file` e `playerId`.
- **Validação:** `playerId` precisa ser UUID; MIME em `{png, jpeg, webp}`; máximo **2 MB**.
- **Guarda de tier:** consulta `players.tier` e devolve **400** se não for `amateur`. Motivo: `source-priority` define `avatar_url` como campo da padelapi; uma foto manual num profissional seria sobrescrita no retorno do sync (hoje pausado por `PADELAPI_PAUSED`), e uma foto que some sem explicação é pior que um botão ausente.
- **Destino:** bucket `avatars` (já existe, usado por [`avatar-rehost.ts`](../../../src/lib/avatar-rehost.ts)), chave `{playerId}.{ext}`, `upsert: true`.
- **Saída:** `{ url }` com a URL pública **acrescida de `?v={timestamp}`**.

O sufixo `?v=` não é enfeite: a chave do arquivo é estável por jogador, então a segunda foto sobrescreve a primeira e tanto o CDN do Supabase quanto o `next/image` continuariam servindo a antiga. O timestamp é o que força a atualização.

A rota **não** escreve no banco, exatamente como a de equipamento — quem persiste é o `PATCH /api/internal/player/[id]`, que já tem `avatar_url` na allow-list.

### UI

Em `apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx`: quando o jogador é amador, o avatar ganha um controle de troca (input de arquivo escondido atrás de um botão sobre a imagem). O fluxo é: escolher arquivo → POST na rota → receber a URL → PATCH → atualizar o estado local. Erros aparecem inline, com a mensagem da rota.

Em jogador profissional nada muda — nenhum controle é renderizado.

### `next.config.ts`

Nenhuma mudança: o domínio do Supabase Storage já está liberado em `remotePatterns`.

## Parte 3 — Múltiplas temporadas

### Fetch

[`src/lib/amateur-profile.ts`](../../../src/lib/amateur-profile.ts) passa a expor duas funções no lugar de uma:

```ts
/** Todas as temporadas do jogador, mais recente primeiro. */
export async function fetchAmateurSeasons(playerId: string): Promise<AmateurSeasonRef[]>

/** Detalhe de uma temporada. Sem seasonId, a mais recente. */
export async function fetchAmateurProfile(
  playerId: string,
  seasonId?: string,
): Promise<AmateurProfileData | null>
```

```ts
export interface AmateurSeasonRef {
  seasonId: string
  label: string      // '25/26'
  teamId: string
  teamName: string   // 'Blue Padel Mataró'
}
```

`buildAmateurProfile` — a função pura onde mora toda a lógica de forma — **não muda**. Ela já recebe as linhas de uma temporada só; quem escolhe qual é o lado de I/O. Os 8 testes existentes seguem valendo.

Ordenação das temporadas: por `team_seasons.starts_on` descendente, com `label` descendente como desempate, porque `starts_on` é nullable e a 25/26 importada não o preencheu.

### UI

Em `AmateurProfile.tsx`:

- Carrega a lista de temporadas junto do detalhe.
- **Com uma temporada só, nada muda visualmente** — nenhum seletor é renderizado. É o estado de todos os 24 jogadores hoje, e não queremos poluir o hero por uma funcionalidade que ainda não tem uso.
- Com duas ou mais, a faixa da equipe ganha um seletor compacto. Trocar refaz os chips do hero e as três abas.
- O seletor troca **equipe e temporada juntas**. Um jogador pode mudar de clube entre temporadas — o modelo permite desde a v1 — e mostrar o time errado ao lado dos números de outra temporada seria afirmar um fato falso.
- A escolha vai pra URL como `?season={label}`, seguindo o que o perfil profissional já faz com aba e ano. Um label desconhecido na URL cai silenciosamente na temporada mais recente.

O label é usado na URL em vez do UUID por ser legível e estável; a resolução label→id acontece contra a lista já carregada.

**O label contém barra** (`25/26`), então precisa de `encodeURIComponent` na escrita e `decodeURIComponent` na leitura — a URL final é `?season=25%2F26`. Sem isso o parâmetro chega truncado ou confunde o roteador. É o tipo de detalhe que só aparece em produção com o segundo clique.

## Testes

- **`src/lib/__tests__/amateur-profile.test.ts`** — os 8 testes de `buildAmateurProfile` seguem intocados. Novo: ordenação de `fetchAmateurSeasons` com `starts_on` nulo, provando o desempate por label.
- **`apps/ops/src/app/api/internal/upload-player-avatar/__tests__/route.test.ts`** — profissional devolve 400; MIME fora da lista devolve 400; arquivo acima de 2 MB devolve 400; amador válido devolve uma URL com `?v=`.
- **Verificação manual** com o build de produção (`npm run build && npx next start`, como o `railway.toml` faz): subir uma foto pelo admin e vê-la no perfil; conferir o selo lendo `Amador · SNP` em pt, es e en; e — depois que a 26/27 for importada — o seletor aparecendo e trocando equipe junto com temporada.

O seletor de temporadas só pode ser verificado de verdade quando existir uma segunda temporada no banco. Até lá, a verificação possível é que **nada mudou** para quem tem uma só.

## Fora de escopo

- Tela de CRUD para equipes e temporadas (os rótulos entram por SQL).
- Upload de foto para profissionais.
- Importar a 26/27 — é rodar o script existente com `--season 26/27` quando o elenco estiver confirmado; não precisa de código.
- Os follow-ups herdados da v1: o vazamento de `hidden` no metadata e a quebra de linha dos nomes na aba Equipe.
