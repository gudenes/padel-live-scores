# Página de equipe — hero com capa e abas

**Data:** 2026-09-09
**Status:** Design — aprovado, pendente plano de implementação
**Branch:** `feat/amateur-admin-v2` (worktree `.worktrees/amateur-profiles`)
**Autor:** brainstorm com o operador (Gustavo)

## Problema

A página de equipe em `/snp/[slug]` funciona e é server-rendered, mas é uma rolagem plana: cabeçalho de texto, três números, 24 jogadores, 11 jornadas, nota de método. Comparada à página de torneio — hero com capa, badge de nível, nome, datas, e abas com estatísticas — ela parece um rascunho.

O operador quer a página de equipe no mesmo padrão: hero com imagem e abas.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Imagem do hero | Upload de capa e escudo pelo admin | Escolha do operador; sem imagem o hero cai no gradiente |
| Abas | Resumen · Plantilla · Jornadas | Três responsabilidades; duas deixariam o Resumen longo demais |
| Renderização das abas | Todas no DOM, inativas escondidas por CSS | Ver abaixo — é a decisão que salva o SEO |
| Superfície de admin | Página mínima de equipes, só imagens e rótulos | Criar/apagar equipe é trabalho do import |

### Abas não podem esconder conteúdo do HTML

O perfil do jogador renderiza **apenas a aba ativa** — o padrão natural em React. Aplicado aqui, o plantel e as jornadas sumiriam do HTML servido, e a página deixaria de ser indexável exatamente no conteúdo que a torna buscável: os nomes dos 24 jogadores e o calendário do clube.

Isso desfaria, em silêncio, o motivo pelo qual a página nasceu server-rendered. O `curl` continuaria achando o nome da equipe e a verificação passaria; só o resto teria evaporado.

**As três abas renderizam no DOM; as inativas ficam com `display: none`.** Com 24 jogadores e 42 pistas o custo de payload é irrelevante, e o crawler vê tudo. Esta é uma regra desta página, não do app: o perfil do jogador continua como está.

## Parte 1 — Schema e imagens

```sql
alter table public.teams
  add column if not exists cover_image_url text;
```

`crest_url` já existe e está nulo. Ambas nullable: sem elas o hero usa o gradiente, que é o estado de hoje e de qualquer equipe nova.

### Bucket

Bucket `teams` no Supabase Storage, criado pela rota no primeiro uso — mesmo padrão de `ensureEquipmentBucket` em [`apps/ops/src/lib/equipment-image-rehost.ts`](../../../apps/ops/src/lib/equipment-image-rehost.ts). Não reaproveita `avatars`, que é de pessoas, nem `equipment`, que é de raquetes.

Chave: `{kind}-{teamId}.{ext}`, com `kind` em `cover` ou `crest`.

### Rota

`apps/ops/src/app/api/internal/upload-team-image/route.ts`, modelada em `upload-equipment-image` — que já usa exatamente este padrão de `kind` + `entityId`.

- Auth: sessão de operador.
- `multipart/form-data` com `file`, `teamId`, `kind`.
- MIME em `{png, jpeg, webp}`; máximo 2 MB.
- Devolve `{ url }` com `?v={timestamp}`.

O `?v=` não é enfeite: a chave é estável por equipe e por tipo, então a segunda capa sobrescreve a primeira e o CDN continuaria servindo a antiga. Já mordeu no upload de foto de jogador.

A rota **não escreve no banco** — quem persiste é o PATCH da página de equipes.

## Parte 2 — Admin mínimo de equipes

Não existe hoje nenhuma tela de equipe no ops. Esta é a menor que resolve o pedido:

- **`apps/ops/src/app/(app)/teams/page.tsx`** — lista as equipes (uma hoje) com nome, competição e temporada.
- **`apps/ops/src/app/(app)/teams/[id]/page.tsx`** — a equipe: os dois uploads (capa e escudo, com pré-visualização) e os campos de texto `badge_label`, `short_name`, `city`, `country`.
- **`apps/ops/src/app/api/internal/team/[id]/route.ts`** — `GET` da equipe e `PATCH` com allow-list: `badge_label`, `short_name`, `city`, `country`, `cover_image_url`, `crest_url`. Qualquer campo fora da lista devolve 400, como faz a rota de jogador.

**Deliberadamente não há criar nem apagar.** Equipe nasce do import; um botão de criar no admin produziria equipes órfãs sem temporada, sem elenco e sem jornadas — objetos que a página pública não sabe renderizar.

`city` e `country` entram porque estão nulos e são o que faz a bandeira aparecer no hero. Hoje o "Barcelona" visível vem do texto da competição, não da cidade.

O link para `/teams` entra no rail de navegação do ops (`apps/ops/src/components/shell/Rail.tsx`) e no command palette (`apps/ops/src/lib/command-palette.ts`) — uma página que só se alcança digitando a URL não existe, na prática.

## Parte 3 — A página

### Estrutura

```
page.tsx (Server Component)
  ├── fetchTeamSeason(anon client)      ← inalterado
  ├── generateMetadata + JSON-LD        ← inalterado
  └── <TeamPageShell …/>                ← client, dono das abas
        ├── hero (capa, escudo, nome, competição, temporada)
        ├── SlidingInkTabs
        └── três painéis, todos no DOM
              ├── Resumen   — três números + nota de método
              ├── Plantilla — <TeamRoster/>
              └── Jornadas  — <TeamFixtures/>
```

O fetch continua no Server Component. `TeamPageShell` recebe tudo por props e não busca nada — é isso que mantém a página server-rendered enquanto as abas são interativas.

`TeamRoster` e `TeamFixtures` não mudam.

### Hero

Com `cover_image_url`: a imagem como fundo, com um gradiente escuro por cima para o texto ficar legível sobre qualquer foto — o mesmo problema que a página de torneio resolve.

Sem capa: gradiente da marca. O hero nunca fica vazio nem quebra.

Sobre o fundo: escudo quando houver, nome, bandeira do país, competição e cidade, e a temporada. Altura fixa, para a página não pular conforme a imagem carrega.

### Resumen

Os três números que já existem — eliminatórias ganhas de jogadas, balanço em pista, pontos a favor e contra — mais a nota de método. É o conteúdo atual, sem as listas.

## Testes

- **`apps/ops/.../upload-team-image/__tests__/route.test.ts`** — `kind` inválido devolve 400; MIME fora da lista devolve 400; acima de 2 MB devolve 400; `teamId` não-UUID devolve 400; sucesso devolve URL com `?v=`.
- **`apps/ops/.../team/[id]/__tests__/route.test.ts`** — o PATCH rejeita um campo fora da allow-list.
- **Verificação manual** com build de produção. Duas que não podem ser puladas:
  1. `curl -s .../es/snp/blue-padel-mataro | grep -c "Gustavo Denes"` deve ser **maior que zero** com a aba Plantilla **inativa**. Zero significa que as abas passaram a esconder conteúdo do HTML e o SEO da página se perdeu.
  2. Subir uma capa pelo admin, recarregar, e confirmar que a imagem aparece — e que uma segunda capa diferente também aparece, provando o cache-busting.

## Fora de escopo

- Criar ou apagar equipe pelo admin.
- Imagem OG dinâmica a partir da capa.
- Recorte ou redimensionamento no upload — a imagem entra como enviada.
- Listagem pública de equipes (`/snp` sem slug).
