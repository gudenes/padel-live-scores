# Share do perfil de jogador + imagem de compartilhamento

**Data:** 2026-09-12
**Status:** Design — aprovado, pendente plano de implementação
**Branch:** `feat/amateur-admin-v2` (worktree `.worktrees/amateur-profiles`)
**Autor:** brainstorm com o operador (Gustavo)

## Problema

O perfil de jogador não tem como ser compartilhado. Quem quer mandar o perfil de um amigo no grupo do clube — ou o do Tapia num grupo de fãs — copia a URL da barra de endereço, e o link chega sem preview nenhum.

A página de partida já resolve isso: tem botão de share e uma `opengraph-image` gerada. O perfil de jogador não tem nem um nem outro, **nem no profissional nem no amador**. Isto não é "igualar o amador ao pro": é funcionalidade nova para os dois.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Conteúdo compartilhado | Só a URL | Escolha do operador; a imagem carrega o resto |
| Anexo de arquivo no share | **Não** | Ver abaixo — anexar troca o preview de link por uma foto solta |
| Rota da imagem | Uma só, ramificando por `tier` | Dois arquivos divergiriam com o tempo |
| Escopo | Perfil profissional **e** amador | O operador pediu paridade |

### Por que não anexar a imagem

A página de partida usa Web Share API nível 2 para anexar o PNG ao compartilhamento. Faz sentido lá: um placar ao vivo precisa estar correto no instante em que é compartilhado, e o preview que o WhatsApp buscaria depois já estaria velho.

Num perfil isso se inverte. Anexar o arquivo faz o destino tratar a mensagem como **uma imagem com um link ao lado**, em vez do cartão de preview que as pessoas reconhecem. E o dado de um perfil não envelhece em segundos.

Sem anexo, o botão perde a busca do PNG com `AbortController`, o `navigator.canShare({ files })` e o caminho de fallback quando o anexo falha — cerca de 80 das 100 linhas do share da partida. O resultado é melhor e o código é menor.

## Parte 1 — A imagem

### Rota

`src/app/[locale]/player/[id]/opengraph-image.tsx`, seguindo a convenção do Next: existindo o arquivo, o `og:image` entra sozinho no metadata que o `layout.tsx` já produz. Nenhuma mudança no layout.

```ts
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 3600
```

Uma hora, não os 60 segundos da partida: um perfil não muda a cada ponto.

### Molde único, quatro números que trocam

Mesma estrutura nos dois tiers — avatar, selo, nome, linha de identidade, quatro caixas, rodapé `PADELNACHOS.COM`:

| | Profissional | Amador |
|---|---|---|
| Selo | `#{ranking} WORLD` | `badge_label` da equipe (ex.: `AMADOR · SNP`) |
| Identidade | bandeira · categoria · idade | bandeira · equipe · temporada |
| Caixa 1 | Win rate | Partidos |
| Caixa 2 | Titles | Balance |
| Caixa 3 | Record | Pontos da competição |
| Caixa 4 | FIP points | Posición |

Uma rota, um `if (tier === 'amateur')` escolhendo as quatro caixas e a linha de identidade. Dois arquivos separados divergiriam — a moldura é a mesma e deve continuar sendo.

### Lições herdadas do OG da partida

Estas não são preferências de estilo; são falhas já pagas em [`src/app/[locale]/match/[id]/opengraph-image.tsx`](../../../src/app/[locale]/match/[id]/opengraph-image.tsx) e documentadas no cabeçalho dele:

- **`fetch` direto contra o REST do Supabase**, não `@supabase/supabase-js` — a lib estoura o orçamento de 500 KB de bundle do `next/og`.
- **Avatar baixado por nós e embutido como data URL base64**, com timeout. O Satori busca `<img src>` sozinho em tempo de render, e um único avatar lento, 404 ou em WebP derruba a rota com 500. Falhando o download, cai no círculo com inicial.
- **Bandeiras por emoji**, que o `next/og` resolve via Twemoji.

### Degradação

Sem foto: círculo com inicial e gradiente da marca. Sem país: sem bandeira. Sem lado: traço na caixa Posición. Sem equipe (amador sem vínculo): a linha de identidade mostra só a bandeira. Nenhum desses casos pode quebrar a rota — todos são o estado real de alguém hoje.

## Parte 2 — O botão

No hero dos dois perfis, ao lado do `FollowButton`. Componente novo `src/components/ShareButton.tsx`, porque os dois perfis o usam e nenhum deles é lugar para essa lógica morar.

Três caminhos, na ordem:

1. **Capacitor nativo** (app Android/iOS) — o plugin `Share` abre a folha do sistema. `navigator.share` é `undefined` dentro do WebView, então checar por ele primeiro pularia o caminho nativo. Esta ordem importa.
2. **Web Share API** — browsers modernos.
3. **Clipboard** — copia a URL e mostra um aviso de "link copiado" por alguns segundos.

Compartilha `{ url }` apenas. O `title` não é entregue pela maioria dos destinos e, tendo escolhido "só o link", não há texto a passar.

A URL é a absoluta do perfil no locale corrente, não `window.location.href` — este carregaria parâmetros de aba e de temporada que ninguém quis compartilhar.

**E o inglês não leva prefixo.** O projeto usa `localePrefix: 'as-needed'`, então a URL do inglês é `https://padelnachos.com/player/{id}` e a dos outros quatro é `https://padelnachos.com/{locale}/player/{id}`. Montar `/en/player/...` produziria um link que não resolve — compartilhado, quebrado, e só descoberto por quem clicasse. É por isso que `buildShareUrl` é pura e testada: é a única parte desta feature onde um erro passa despercebido em revisão.

Cancelar a folha de compartilhamento **não é erro**: o `navigator.share` rejeita com `AbortError` quando o usuário fecha, e isso não pode virar mensagem de falha.

## Parte 3 — i18n

`common.share` já existe nos cinco locales. Falta uma chave para o aviso do fallback:

- `common.linkCopied` — en `"Link copied"`, es `"Enlace copiado"`, pt `"Link copiado"`, it `"Link copiato"`, fr `"Lien copié"`

## Testes

A rota de imagem não tem teste unitário razoável — ela renderiza um PNG através do Satori, e afirmar sobre bytes de imagem não diz nada útil. A verificação é:

- Abrir `/{locale}/player/{id}/opengraph-image` para um profissional e para um amador e conferir o card.
- Conferir os casos de degradação com dados reais: um amador sem foto (23 dos 24 hoje), um sem país (idem), e o Gustavo, que tem os dois.
- Passar a URL do perfil por um validador de preview de link e ver o cartão.

O botão é verificado no browser: o fallback de clipboard com o aviso, e que cancelar a folha não mostra erro.

O que **tem** teste unitário é a montagem da URL compartilhada — `buildShareUrl(locale, playerId)` é pura e é onde um erro (locale errado, parâmetros vazando) passaria despercebido.

## Fora de escopo

- Compartilhar a página de equipe (`/snp/[slug]`) — mesmo padrão, outro trabalho.
- Anexar a imagem ao compartilhamento.
- Imagem OG para a página de equipe.
- Contabilizar compartilhamentos.
