# Perfil amador + conceito de equipe

**Data:** 2026-09-09
**Status:** Design — aprovado, pendente plano de implementação
**Branch:** `feat/amateur-profiles-teams` (worktree `.worktrees/amateur-profiles`)
**Autor:** brainstorm com o operador (Gustavo)

## Problema

O PadelNachos só conhece jogadores profissionais (FIP / padelapi). Queremos publicar **perfis de jogadores amadores** com a mesma linguagem visual do perfil pro, aceitando que os dados são bem mais pobres.

O caso motivador é o **Blue Padel Mataró na temporada 25/26** das Series Nacionales de Pádel (SNP), Barcelona, Masculino 1000: 24 jogadores inscritos, 9 jornadas completas + J10 e playoff parciais. Cada jornada é um confronto entre dois clubes disputado em **cinco pistas** — pistas 1 e 2 valem 3 pontos, pistas 3, 4 e 5 valem 2 pontos; 12 pontos em jogo e leva a eliminatória quem somar mais.

Disso nasce o segundo pedido, mais estrutural: o conceito de **equipe**. Ele não existe hoje no modelo de dados e é útil muito além do amador — Reserve Cup, campeonatos de clubes, competições por seleção, qualquer formato onde um resultado coletivo é composto por vários jogos individuais.

## Limitações da fonte (parte do produto, não nota de rodapé)

Os dados do Blue Padel foram reconstruídos cruzando a tabela *Ranking por Jornadas → Ranking Año Anterior* dos 24 jogadores em snpgalaxy.com. Consequências que a UI **precisa** admitir na cara do usuário:

- **Não há adversário.** A SNP não expõe o calendário da 25/26 para essa conta.
- **Não há placar por set.** Só "ganhou/perdeu" e se foi a 2 ou 3 sets.
- **A pista é conhecida por valor, não por número.** Sabemos se foi uma pista de 3 pontos (1–2) ou de 2 pontos (3–5); o número exato dentro do bloco é arbitrado por nós.
- **Parceiros são deduzidos.** Dois jogadores da mesma pista compartilham resultado. Quando o resultado é único no bloco, a dupla é exata; quando várias pistas terminaram igual, o grupo é ambíguo — a UI marca isso como "provável".
- **J10 e playoff são registro parcial** e ficam fora dos totais.

Essas limitações são estruturais da fonte, não temporárias. Qualquer widget que precise de placar por set, adversário ou estatística de ponto **não existe** no perfil amador.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Eixo do MVP | Jogador no centro; equipe como aba/atributo | Reaproveita `/player/[id]` inteiro |
| Onde mora o amador | Mesma tabela `players` + coluna `tier` | Reuso de busca, follow, avatar, admin; risco fechável em 3 guards |
| Entrada de dados | Direto no banco, via script de import a partir do Excel do operador | Sem telas de CRUD no v1; automação fica pra depois |
| Visibilidade | Público igual ao pro | Escolha do operador; mitigado por `players.hidden` |
| Página de equipe | Aba dentro do perfil no v1 | `/equipe/[slug]` própria fica pra v2 |

## Arquitetura

```
Excel do operador
   │  (convertido pra CSV na mão)
   ▼
scripts/import-amateur-season.ts   --dry-run | --apply
   │
   ├── players            (tier='amateur', home_club, hidden; reusa side)
   ├── teams              (entidade reutilizável: amador + pro)
   ├── team_seasons
   ├── team_memberships
   ├── team_fixtures      (a jornada)
   └── team_fixture_slots (a pista dentro da jornada)
                    │
                    ▼
        /player/[id]  →  ramifica por tier
                          ├── pro      → page.tsx atual (intocado)
                          └── amateur  → AmateurProfile.tsx (novo)
```

### Modelo de dados

#### `players` — colunas novas

```sql
alter table public.players
  add column tier text not null default 'pro',
  add column home_club text,
  add column hidden boolean not null default false;

alter table public.players
  add constraint players_tier_check check (tier in ('pro','amateur'));

create index players_tier_idx on public.players (tier) where tier <> 'pro';
```

**A posição preferida não é campo novo.** `players.side` já existe (`'drive'` / `'backhand'`) e já é editável pelo `SuggestChangesSheet` via `SUGGESTABLE_FIELDS`. O perfil amador consome essa coluna; criar um `preferred_side` paralelo seria duplicação.

`home_club` vale para os dois tiers.

**`hidden`** é a válvula de escape de privacidade: perfil publicado por padrão, mas se alguém do elenco pedir remoção, um UPDATE tira do ar (404 + fora do sitemap) sem deploy.

#### Guards de isolamento — os três pontos que importam

O risco de misturar amador com pro é concentrado, não difuso. Fechar em três lugares:

1. **`src/lib/player-resolver.ts`** — o `PlayerResolver` **nunca** considera `tier='amateur'` como candidato, em nenhum dos 5 tiers de resolução (fip_id, external_id, nome normalizado, fuzzy, alias). Um amador chamado "Juan Rivas" não pode ser casado com um jogador FIP homônimo. Este é o guard crítico.
2. **Leituras do produto pro** — rankings, carrossel, `/rankings` e `money_leaderboard` já excluem amadores por construção: todas filtram por `ranking`, `points` ou prêmio, e nenhum amador tem qualquer um deles. O helper `src/lib/player-tier.ts` existe para quando um filtro explícito for necessário. **Busca global e sitemap são a exceção deliberada:** amadores entram nos dois, porque a decisão foi publicá-los como os profissionais. O que sai de ambos é `hidden=true`.
3. **`padelgod/src/workers/player-rankings.ts`** — nunca escreve `players.ranking*`, `race_ranking*` nem `player_ranking_snapshots` para linha com `tier='amateur'`.

O ranking amador **não** vai para `player_ranking_snapshots`. Ele vive em `team_memberships` (ver abaixo), porque é ranking de uma competição específica, não o ranking mundial.

#### `teams` — a entidade nova reutilizável

```sql
create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,          -- 'blue-padel-mataro'
  name          text not null,                 -- 'Blue Padel Mataró'
  club          text,                          -- 'Blue Padel'
  city          text,                          -- 'Mataró'
  country       text,                          -- 'ES'
  crest_url     text,
  competition   text,                          -- 'Series Nacionales de Pádel · Barcelona · Masculino 1000'
  category      text,                          -- 'men' | 'women' | 'mixed'
  source        text not null default 'manual',-- 'snp' | 'manual' | …
  external_id   text,
  created_at    timestamptz not null default now(),
  unique (source, external_id)
);
```

Deliberadamente agnóstica de amador/pro. A mesma tabela serve para a Reserve Cup ou um campeonato de clubes profissional no futuro; nada aqui assume que os jogadores são amadores.

#### `team_seasons`

```sql
create table public.team_seasons (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  label          text not null,        -- '25/26'
  starts_on      date,
  ends_on        date,
  ranking        int,                  -- posição da equipe na competição (#7)
  ties_played    int,                  -- 9
  ties_won       int,                  -- 3
  courts_won     int,                  -- 20
  courts_lost    int,                  -- 25
  points_for     int,                  -- 46
  points_against int,                  -- 62
  notes          text,                 -- texto de método/limitações mostrado na UI
  created_at     timestamptz not null default now(),
  unique (team_id, label)
);
```

Os totais são **denormalizados de propósito**: são exatamente o que o operador tem no Excel e o que a fonte publica, e não queremos que a UI recalcule algo que não bate com a fonte por causa das jornadas parciais.

#### `team_memberships`

```sql
create table public.team_memberships (
  id               uuid primary key default gen_random_uuid(),
  team_season_id   uuid not null references public.team_seasons(id) on delete cascade,
  player_id        uuid not null references public.players(id) on delete cascade,
  competition_points numeric,      -- 41250.00 (pontos SNP)
  competition_rank   int,          -- #412 no ranking da competição
  roster_rank        int,          -- 9º do elenco, por pontos
  games_played       int,
  wins               int,
  losses             int,
  created_at         timestamptz not null default now(),
  unique (team_season_id, player_id)
);
```

Um jogador pode estar em várias equipes e várias temporadas. Os agregados aqui também vêm do Excel, pelo mesmo motivo dos totais da temporada.

#### `team_fixtures` — a jornada

```sql
create table public.team_fixtures (
  id             uuid primary key default gen_random_uuid(),
  team_season_id uuid not null references public.team_seasons(id) on delete cascade,
  code           text not null,        -- 'J1' … 'J10', 'POFF'
  label          text not null,        -- 'Jornada 1', 'Playoff'
  sort_order     int not null,
  played_on      date,
  opponent_name  text,                 -- null quando a fonte não expõe
  complete       boolean not null default true,
  result         text,                 -- 'W' | 'L' | 'D' | null (parcial)
  points_for     int,
  points_against int,
  courts_won     int,
  courts_lost    int,
  unique (team_season_id, code)
);
```

`complete=false` (J10, playoff) → a UI mostra "registro parcial", esconde o placar e a jornada fica fora dos totais.

#### `team_fixture_slots` — a pista

```sql
create table public.team_fixture_slots (
  id           uuid primary key default gen_random_uuid(),
  fixture_id   uuid not null references public.team_fixtures(id) on delete cascade,
  label        text not null,      -- 'Pista 1' | 'Pistas 3 y 4'
  worth        int not null,       -- 3 | 2
  slot_group   int not null,       -- 3 = bloco pista 1–2, 2 = bloco pista 3–5
  result       text,               -- 'W' | 'L'
  sets         int,                -- 2 | 3
  court_count  int not null default 1,  -- >1 quando várias pistas foram agrupadas
  exact        boolean not null default true,  -- false = dupla ambígua
  partial      boolean not null default false, -- alinhamento incompleto
  sort_order   int not null,
  unique (fixture_id, sort_order)
);

create table public.team_fixture_slot_players (
  slot_id   uuid not null references public.team_fixture_slots(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (slot_id, player_id)
);
```

`exact=false` é o que faz a UI escrever *"mesmo resultado em 2 pistas — a dupla exata não consta"* e marcar parceiros como "prováveis". Quando `exact=true` e `court_count=1`, os dois jogadores do slot são a dupla real.

**RLS:** anon lê `teams`, `team_seasons`, `team_memberships`, `team_fixtures`, `team_fixture_slots`, `team_fixture_slot_players`. Escrita só via service key (script de import).

## UI

### Rota

Reaproveita `/player/[id]`. A página ramifica por `tier` logo depois do fetch do jogador:

- `tier='pro'` → o `page.tsx` atual, **intocado**.
- `tier='amateur'` → `AmateurProfile.tsx`, arquivo novo no mesmo diretório.

`page.tsx` já tem 2.220 linhas. O perfil amador tem outras abas, outros widgets e outra origem de dados — empilhar ali seria piorar um arquivo que já está grande demais. Componente separado, mesma linguagem visual.

`hidden=true` → `notFound()`.

### Reuso de componentes

| Componente | Onde está | Uso no amador |
|---|---|---|
| `Widget`, `WidgetIcon` | `player/[id]/Widget.tsx` | Grid de widgets do Resumo |
| `Last10SparkBar` | hoje **dentro** de `page.tsx:63` | Widget "Últimos jogos" |
| `FollowButton` | `src/components/` | Seguir jogador amador |
| `SlidingInkTabs` | `src/components/` | As 3 abas |
| `FlagImage` | `src/components/` | Bandeira no hero |
| `SuggestChangesSheet` | `src/components/SuggestChangesSheet.tsx` | "Sugerir alteração" |
| `useInViewOnce` | `src/hooks/` | Animação das barras |

**Único refactor proposto:** mover `Last10SparkBar` de `page.tsx` para `Widget.tsx`, para os dois perfis consumirem a mesma implementação. É extração pura, sem mudança de comportamento, no arquivo que já estamos tocando. Nenhum outro refactor entra neste escopo.

### Hero

- Avatar (iniciais com gradiente quando não há foto — amador raramente terá).
- **Selo de origem** verde no lugar do `#rank World`: `Amador · SNP Barcelona`.
- Nome, categoria, idade, clube.
- `FollowButton`.
- **Quatro chips:** Jogos (7) · Balanço (2–5) · **Ranking SNP** (#412) · Posição (Drive). Não são clicáveis — diferente do pro, não há página de ranking amador para onde navegar.
- **Faixa da equipe** no lugar da faixa "próximo jogo": nome da equipe, `#7 no ranking SNP`, competição e temporada. Leva para a aba Equipe.

### Abas

**Resumo** — grid de widgets:
- *Últimos jogos* (largura total) — `Last10SparkBar`; verde/vermelho por resultado, altura codificando jogo de 3 sets; rótulos da primeira e da última jornada.
- *Posição preferida* — Drive / Revés.
- *Pista habitual* — "Pista 1–2, 6 de 7, vale 3 pontos". Diz onde o capitão confia no jogador.
- *Aproveitamento* — % com barra.
- *Pontos SNP* — 41.250 e "9º do elenco".
- *Parceiros* — chips clicáveis; os ambíguos aparecem agrupados como "+N prováveis".
- *Sugerir alteração* — abre o `SuggestChangesSheet`.
- *Aviso de método* — as limitações da fonte, visíveis, não escondidas.

**Temporada** — tabela jornada a jornada: código da jornada, bloco de pista (1–2 / 3–5), resultado, sets. Borda esquerda verde/vermelha. Jornadas parciais em opacidade reduzida.

**Equipe** — elenco clicável (24 cards, incluindo os 3 inscritos que não jogaram) + as jornadas com o confronto pista a pista, cada pista listando quem jogou e marcando as duplas ambíguas.

### i18n

Strings novas nos 5 locales (`en`, `es`, `pt`, `it`, `fr`) em `src/messages/*.json`, namespace `amateur.*`. Nomes de competição e equipe vêm do banco, não são traduzidos.

### SEO

Perfil amador entra no sitemap e é indexável, igual ao pro — exceto quando `hidden=true`. JSON-LD `Person` reaproveitado, sem `athlete`/ranking mundial.

## Import

`scripts/import-amateur-season.ts`, no padrão dos scripts existentes do repo.

- Lê **CSV** (o operador manda Excel; a conversão para CSV é feita à mão na hora do import). Não adicionamos dependência de xlsx ao projeto por causa de um import pontual.
- Três arquivos: `players.csv`, `fixtures.csv`, `slots.csv`. O formato exato é definido no plano de implementação, a partir do Excel real.
- Casa nomes contra `players` usando o mesmo normalizador (`unaccent` + `normalized_name`) já existente; jogador não encontrado **é criado** com `tier='amateur'`.
- `--dry-run` (padrão) imprime o que criaria e o que casaria, sem escrever. `--apply` grava.
- Idempotente: re-rodar não duplica. Chaves de conflito: `teams(source, external_id)`, `team_seasons(team_id,label)`, `team_memberships(team_season_id,player_id)`, `team_fixtures(team_season_id,code)`, `team_fixture_slots(fixture_id,sort_order)`.
- Migração aplicada via driver `pg` + `DATABASE_URL`, **não** via `supabase db push` (o repo tem drift de migrations).

## Testes

- **`src/lib/__tests__/player-tier.test.ts`** — o helper `PRO_ONLY` e os guards.
- **`src/lib/__tests__/player-resolver-amateur.test.ts`** — o resolver não casa amador em nenhum dos 5 tiers, inclusive com nome idêntico a um pro. É o teste mais importante do escopo.
- **`scripts/__tests__/import-amateur-season.test.ts`** — parsing do CSV, dedução de dupla exata vs ambígua, idempotência do re-import.
- **Verificação manual** no app rodando (`npm run dev`, :3002): perfil do Gustavo Denes com os dados reais, as 3 abas, `hidden=true` dando 404, e um perfil pro qualquer inalterado.

## Fora de escopo (v2+)

- Telas de CRUD no admin para equipes e temporadas.
- Página própria `/equipe/[slug]`.
- Automação do scrape da SNP.
- Notificações, live score, estatísticas de ponto para amador.
- Fluxo de opt-in/consentimento do jogador.
- Aplicar `teams` a eventos profissionais (Reserve Cup) — a tabela já nasce pronta, mas a integração é outro trabalho.
