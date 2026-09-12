# Página de equipe + raquete no perfil amador

**Data:** 2026-09-09
**Status:** Design — aprovado, pendente plano de implementação
**Branch:** `feat/amateur-admin-v2` (worktree `.worktrees/amateur-profiles`)
**Autor:** brainstorm com o operador (Gustavo)

## Problema

Três lacunas apareceram usando o perfil amador já construído:

1. **A raquete não aparece no perfil amador.** O operador cadastrou a Babolat Air Viper 2025 pelo admin e nada mudou na página — o widget "Plays with" só existe no perfil profissional.
2. **A aba Equipe está longa demais.** Ela carrega o elenco de 24 jogadores *mais* as 11 jornadas com as 42 pistas, tudo empilhado num perfil individual. É o documento inteiro do clube dentro da página de uma pessoa.
3. **Não há endereço para a equipe.** O Blue Padel não tem uma página própria para o pessoal do clube compartilhar.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Propósito da página | Página de destino, compartilhável | Escolha do operador — exige metadata, OG e sitemap |
| Endereço | `/snp/[slug]`, pasta **literal** | Ver abaixo |
| Conteúdo do resumo na aba | Identidade + balanço da temporada | O calendário migra para a página |
| Widget de raquete | Extrair para componente compartilhado | Duplicar perderia a atribuição de afiliado |

### Por que pasta literal e não segmento dinâmico

Uma rota `/[liga]/[equipe]` viveria na raiz do locale e competiria com `/player`, `/match`, `/tournaments`, `/events`. O Next.js prioriza o segmento estático, então funcionaria hoje — mas qualquer rota nova poderia ser sombreada por um slug de liga, e o contrário também. Como pasta literal `snp/[slug]`, não há sobreposição possível. Uma segunda liga vira outra pasta.

A resolução é por `slug` **dentro de** `source='snp'`, não por slug global: `teams.slug` é único hoje, mas o que a URL promete é "esta equipe, nesta liga".

## Parte 1 — Widget de raquete compartilhado

### O problema real

O widget vive inline em [`src/app/[locale]/player/[id]/page.tsx`](../../../src/app/[locale]/player/[id]/page.tsx) (~linhas 1210–1300) e **contém o rastreamento de afiliado**: ao clicar, faz `POST /api/racket-click` com `racket_id` e `player_id`, e o backend resolve o parceiro pelo país do visitante ([`src/lib/racket-partner-resolver.ts`](../../../src/lib/racket-partner-resolver.ts)) antes de abrir o link.

Copiar o markup para o perfil amador criaria um segundo caminho sem essa chamada. O clique do amador abriria o `product_url` cru, sem atribuição — receita perdida, e perdida em silêncio, porque a página pareceria funcionar.

### A extração

Componente novo `src/app/[locale]/player/[id]/PlaysWithCard.tsx`, recebendo a raquete já resolvida e o `playerId`. O `page.tsx` passa a consumi-lo no lugar do bloco inline; o `SummaryTab.tsx` do amador passa a renderizá-lo quando há raquete.

A lógica de clique — incluindo o `POST` e o fallback silencioso para `product_url` quando a chamada falha — move junto, sem alteração de comportamento.

O fetch do equipamento (`player_equipment` → `padel_rackets` → `padel_brands`) é o mesmo nos dois lados; `fetchAmateurProfile` não muda — o `AmateurProfile` busca o equipamento separadamente, como o perfil profissional já faz.

**Quando não há raquete, nada é renderizado.** Nenhum estado vazio, nenhum "sem raquete cadastrada" — 23 dos 24 jogadores estão nessa situação e um card vazio repetido seria ruído.

## Parte 2 — Página `/snp/[slug]`

### Rota

`src/app/[locale]/snp/[slug]/page.tsx`, fora do grupo `(app)` — mesma escolha de `/player/[id]`, que renderiza o próprio `BottomNav`. A página de equipe é irmã do perfil, não um item da navegação principal.

### Conteúdo

Na ordem em que aparece:

1. **Cabeçalho** — nome da equipe, escudo quando houver, competição, cidade, país com bandeira, e a temporada exibida.
2. **Totais da temporada** — eliminatórias ganhas de jogadas, balanço em pista, pontos a favor e contra. Os mesmos números denormalizados em `team_seasons`, que são o que a fonte publica.
3. **Elenco** — os 24 jogadores, clicáveis para o perfil. Quem não jogou aparece marcado como tal, não escondido: estar inscrito e não jogar é informação.
4. **Jornadas** — as 11, cada uma com o placar da eliminatória e as pistas: rótulo, valor em pontos, resultado, sets, e quem jogou. Duplas incertas marcadas. Jornadas parciais sem placar, com a explicação.
5. **Nota de método** — o `team_seasons.notes`, visível, não escondido em rodapé.

Com mais de uma temporada, um seletor no cabeçalho — mesma lógica já construída para o perfil, reusando `fetchAmateurSeasons`.

### Dados

Reusa `src/lib/amateur-profile.ts`. A função `buildAmateurProfile` é orientada a um jogador (`games`, `partners`, `record` são dele), mas os campos `team`, `season`, `roster` e `fixtures` são da equipe e servem a página inteira.

Para evitar torcer uma função de perfil em função de equipe, a página ganha seu próprio par no mesmo módulo:

```ts
export interface TeamSeasonPageData {
  team: AmateurRawRows['team']
  season: AmateurRawRows['season']
  roster: AmateurRosterEntry[]
  fixtures: AmateurFixture[]
}

/** Team-season view: everything about the squad, nothing about one player. */
export async function fetchTeamSeason(
  client: SupabaseClient,
  slug: string,
  source: string,
  seasonLabel?: string,
): Promise<TeamSeasonPageData | null>
```

**O cliente entra por parâmetro, e isso não é detalhe de estilo.** `src/lib/amateur-profile.ts` hoje importa o cliente do browser (`import { supabase } from '@/lib/supabase'`), que não funciona num Server Component. Sem essa inversão a página simplesmente não roda — e o erro só apareceria em runtime.

**Qual cliente a página usa importa mais ainda.** `createServerClient` neste repo é alias de `createServiceClient` ([`src/lib/supabase.ts:47`](../../../src/lib/supabase.ts)) — a service key, que **ignora RLS**. Uma página pública não deve renderizar com ela: hoje as tabelas de equipe têm política de leitura para `anon`, então a service key não mostraria nada a mais; mas no dia em que uma política for apertada (por exemplo para respeitar `players.hidden`), a página continuaria servindo o que a política passou a proteger, sem nenhum sinal.

A página usa um cliente **anon no servidor** — `createClient` com `NEXT_PUBLIC_SUPABASE_ANON_KEY`, instanciado por requisição. Se um helper assim não existir em `src/lib/supabase.ts`, ele é criado como parte deste trabalho. A regra: o que o visitante anônimo pode ler é exatamente o que a página renderiza.

`fetchAmateurProfile` e `fetchAmateurSeasons` ganham o mesmo parâmetro, e os dois call sites atuais passam o cliente do browser explicitamente. É uma mudança mecânica em três funções e dois chamadores.

A montagem pura (`fixtures` com slots ordenados, `exact && court_count === 1`, roster ordenado por `roster_rank`) é **a mesma lógica** de `buildAmateurProfile`. Ela é extraída para funções puras compartilhadas em vez de duplicada — duas cópias divergiriam, e a regra de dupla incerta é justamente a que não pode divergir.

### SEO

- `generateMetadata`: título `"{equipe} — {competição} {temporada} | Padel Nachos"`, descrição com o balanço da temporada.
- JSON-LD `SportsTeam` com nome, esporte, local e membros.
- Canonical + hreflang nos cinco locales, como as demais páginas.
- Sitemap novo `src/app/sitemap-teams.xml/route.ts`, seguindo `sitemap-players.xml`, registrado no índice.

A página é **server-rendered**. O perfil amador é client-side por herança do perfil profissional; a página de equipe nasce sem essa dívida, e sendo destino compartilhável precisa que o crawler veja conteúdo, não uma casca. É também o oposto do problema registrado em `seo-indexing-csr-shells`.

### i18n

Strings novas nos cinco locales sob `team.*`. Nome da equipe, competição e a nota de método vêm do banco e não são traduzidos.

## Parte 3 — Aba Equipe vira resumo

A aba passa a mostrar **um card**, que **nasce recolhido**: nome da equipe, competição, cidade e temporada. Um toque expande e revela os totais — eliminatórias ganhas de jogadas, balanço em pista, pontos a favor e contra — mais o link para `/snp/[slug]`.

Recolhido por padrão porque a aba tem um único card: abrir já expandido tornaria o controle decorativo, e quem quer os números está a um toque deles.

**O elenco e as 11 jornadas saem da aba.** Isso remove conteúdo de onde ele está hoje: quem via o calendário dentro do perfil passa a precisar de um clique. É deliberado — a aba carregava o documento inteiro do clube dentro da página de uma pessoa — mas é uma troca real, não apenas reorganização.

`TeamTab.tsx` encolhe de ~120 linhas para algo em torno de 50. O que sai não é apagado: vira os componentes de elenco e jornadas usados por `/snp/[slug]`.

## Testes

- **`src/lib/__tests__/amateur-profile.test.ts`** — os 8 testes existentes seguem valendo; eles cobrem a lógica agora compartilhada, o que é o ponto da extração.
- **Novo** — `fetchTeamSeason` devolve a equipe pelo par slug+source, e devolve `null` para um slug de outra liga. Esse segundo caso é o que impede a URL de prometer uma liga e servir outra.
- **Novo** — a montagem pura de `fixtures` produz o mesmo resultado consumida pelo perfil e pela página, provando que a extração não bifurcou a regra de dupla incerta.
- **Verificação manual** com build de produção: `/snp/blue-padel-mataro` nos cinco locales, o card resumido na aba, o link, a raquete no perfil do operador, e o `curl` do HTML provando que o conteúdo é server-rendered e não uma casca.

## Fora de escopo

- Listagem de equipes (`/snp` sem slug).
- CRUD de equipe no admin.
- Imagem OG gerada dinamicamente — a página entra com a imagem padrão do site; um OG próprio é trabalho separado.
- Segunda liga: quando existir, vira outra pasta literal.
