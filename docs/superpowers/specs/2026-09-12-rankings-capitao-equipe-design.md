# Rankings nacional e local, capitão, e a equipe sob o nome

**Data:** 2026-09-12
**Status:** Design — aprovado, pendente plano de implementação
**Branch:** `feat/amateur-admin-v2` (worktree `.worktrees/amateur-profiles`)
**Autor:** brainstorm com o operador (Gustavo)

## Problema

Três lacunas no perfil amador, todas vindas do mesmo lugar — a planilha de ranking da SNP que o operador mantém e que o primeiro import não consumiu:

1. **Não há ranking.** O perfil mostra pontos e balanço, mas não a posição do jogador. A SNP publica duas: nacional (Espanha) e zonal (Catalunha/Barcelona). A local é a que interessa a quem joga — é a que mede você contra gente que você pode encontrar numa quadra.
2. **A equipe não aparece sob o nome.** Ela vive numa faixa laranja abaixo dos números, longe da identidade do jogador.
3. **Não há como marcar o capitão.** O Eric Ortega é o capitão do Blue Padel e isso não existe no modelo.

## Os dados

A planilha tem uma linha por jogador dos 24:

| Coluna | Uso |
|---|---|
| `ID` | ID da SNP — `254659`, `309288`, … |
| `Jugador/a` | Nome, em caixa mista ou alta |
| `Puntos` | Já importado como `competition_points` |
| `Ranking Nacional (cat. 1000)` | Novo |
| `Ranking Zonal (cat. 1000)` | Novo — o principal |
| `Notas` | `Capitán` no Eric Ortega |
| `Categoría actual` / `Etiqueta 26/27` | **Fora de escopo** (ver abaixo) |

Três jogadores — Mario Estrada, Wenjie Zhou e Abraham Torres — trazem `s/d` nas três colunas numéricas. São exatamente os três que nunca jogaram.

**`s/d` vira `NULL`, nunca `0`.** Um zero num ranking afirma "primeiro colocado", que é o oposto de "não há dado". Esta é a regra mais fácil de errar neste trabalho.

Os nomes casam: verifiquei os 24 contra o banco pelo nome normalizado e todos bateram, incluindo as variações em caixa alta e com acento.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde ficam os rankings | `team_memberships` | Já é a tabela por jogador **e** por temporada — o recorte exato de um ranking de temporada |
| `competition_rank` | **Removido** | Está nulo nos 24 e vira ambíguo ao lado de nacional e local |
| ID da SNP | Guardado em `entity_external_ids` | Ver abaixo |
| Categoria (1000/500/Future) | Fora de escopo | Não apareceria em tela nenhuma hoje |
| Faixa da equipe no hero | Removida | A equipe passa a viver sob o nome |

### Por que guardar o ID da SNP

O import atual casa por nome normalizado. Funcionou nos 24, mas é frágil de um jeito específico: se alguém corrigir "Diaz" para "Díaz" na planilha, o próximo import **cria um jogador novo** em vez de atualizar o existente — e o perfil antigo fica órfão, com o histórico, enquanto o novo nasce vazio.

O projeto já tem a solução: `entity_external_ids` é a tabela polimórfica para IDs de fontes secundárias, usada exatamente assim para padelapi e outras. O ID entra como `(entity_type='player', source='snp', external_id='309288')`, e o casamento passa a ser por ID com o nome como fallback.

Isto não é trabalho extra inventado: o ID está na planilha, é gratuito de guardar agora, e caro de retroagir depois que existir uma duplicata.

## Parte 1 — Schema

```sql
alter table public.team_memberships
  add column if not exists national_rank int,
  add column if not exists local_rank    int,
  add column if not exists is_captain    boolean not null default false;

alter table public.team_memberships
  drop column if exists competition_rank;

comment on column public.team_memberships.national_rank is
  'SNP national position for the season. NULL = no ranking published (s/d).';
comment on column public.team_memberships.local_rank is
  'SNP zonal position (Catalunya/Barcelona). The one the UI leads with.';
```

`competition_rank` sai no mesmo passo. Ele é nulo nas 24 linhas — confirmado antes de escrever isto — então a remoção não perde dado. Deixá-lo ao lado de dois rankings nomeados seria manter um campo cujo significado ninguém sabe explicar.

**`is_captain` é booleano por vínculo**, ou seja, por jogador e por temporada. A capitania muda entre temporadas, e o modelo precisa permitir isso. O operador confirmou que hoje há um capitão só; se a SNP passar a distinguir capitão de delegado, isso vira um `role text` e o booleano migra — mas modelar dois papéis agora seria construir para um requisito que não existe.

## Parte 2 — Entrada dos dados

O import de temporada (`scripts/import-amateur-season.ts`) já lê `players.csv`. Ele ganha quatro colunas novas, todas opcionais:

`snp_id`, `national_rank`, `local_rank`, `is_captain`

- Valores vazios ou `s/d` viram `NULL` (ou `false`, no capitão).
- `snp_id` é gravado em `entity_external_ids` com `source='snp'`.
- **A resolução passa a tentar o ID primeiro**, caindo no nome normalizado quando não houver ID. Um jogador já existente com o mesmo `snp_id` é atualizado, não duplicado.

Os dados de hoje entram por uma execução do mesmo script com o CSV atualizado — não há caminho paralelo. Um script separado para "só os rankings" seria um segundo lugar onde a mesma regra de `s/d` poderia divergir.

## Parte 3 — A tela

### Hero

A linha sob o nome passa a mostrar **bandeira · equipe**, e a faixa laranja da equipe sai. Uma informação, um lugar. O acesso à página da equipe continua na aba Equipe.

Essa linha mostra hoje `home_club` e a cidade da equipe. Ambos saem — e isso deixa **`players.home_club` sem nenhum leitor**: a coluna foi criada no primeiro import, não está na tela de edição do ops, e agora não aparece em lugar nenhum. Ela não é removida aqui porque não atrapalha e o custo de uma migração a mais não se paga, mas fica registrado: é uma coluna que ninguém escreve e ninguém lê. Se daqui a duas temporadas ela continuar assim, o certo é apagá-la, não encontrar um uso para justificá-la.

Os quatro chips passam a ser:

| Antes | Depois |
|---|---|
| Jogos | Jogos |
| Balanço | Balanço |
| Ranking da competição *(sempre vazio)* | **Ranking local** |
| Posição | Posição |

O **ranking local lidera** porque é o que o operador identificou como relevante: mede o jogador contra quem ele pode encontrar numa quadra. O nacional é um número grande e distante — 4.028 num universo de dezenas de milhares diz pouco sobre a próxima partida.

Sem ranking local, o chip mostra traço, como os outros já fazem.

### Ranking nacional

Widget na aba Resumo, ao lado dos pontos. Fora do hero de propósito: quatro chips é o que cabe na largura de um celular, e o quinto empurraria o principal para fora.

### Capitão

Insígnia ao lado do nome no hero e ao lado do nome na lista do plantel — pequena, com o rótulo traduzido nos cinco locales. Não é um chip: capitania é um atributo de identidade, não uma estatística.

## Testes

- **`src/lib/__tests__/amateur-profile.test.ts`** — os testes existentes ganham os campos novos nos fixtures; o `buildRoster` passa a carregar `isCaptain`.
- **`scripts/__tests__/amateur-csv.test.ts`** — novos casos: `s/d` vira `NULL` em cada uma das três colunas numéricas; `is_captain` vazio vira `false`; `snp_id` ausente não quebra a linha.
- **Um teste que importa mais que os outros:** re-rodar o import com um nome corrigido (`Diaz` → `Díaz`) e o mesmo `snp_id` **não** cria um segundo jogador. É a razão de o ID existir, e sem esse teste a proteção é só uma intenção.
- **Verificação manual** com build de produção: o chip do ranking local no hero, o nacional no Resumo, a insígnia no Eric, a equipe sob o nome, e os três jogadores com `s/d` mostrando traço — não zero.

## Fora de escopo

- Categoria do jogador (1000 / 500 / Future) e a etiqueta 26/27.
- Histórico de ranking ao longo das semanas.
- Distinção entre capitão e delegado.
- Ranking na página da equipe.
