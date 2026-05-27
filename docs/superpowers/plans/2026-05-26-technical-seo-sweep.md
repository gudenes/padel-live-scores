# Technical SEO Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 7 technical SEO bugs identified via live GSC URL Inspection + production HTML audit, so Google can see the site cleanly and we stop fighting its canonical decisions.

**Architecture:** A series of small, independently shippable PRs. Each PR is scoped to one issue, can roll back individually, and is verified via curl + SQL against production. No new features — only fixes to existing pages, redirects, and metadata.

**Tech Stack:** Next.js 16, next-intl, TypeScript, Vitest. Live verification via `curl` + GSC's URL Inspection API + Supabase SQL.

**Investigation context:** This plan is the output of a multi-day diagnostic in which we (a) built the SEO dashboard at admin.padelnachos.com/system/seo, (b) ingested real GSC + sitemap data, (c) used GSC URL Inspection on 7 representative URLs, and (d) traced every redirect on the site. The relevant findings:

| Finding | Severity | Source of truth |
|---|---|---|
| `src/app/[locale]/page.tsx` uses bare `redirect('/home')` — drops locale | 🔴 High | Code grep + curl on `/es`, `/pt`, `/it`, `/fr` (all 307 to English `/home`) |
| Tournament/player/match layouts call `buildAlternates(path)` without `locale` arg — canonical defaults to English on locale-prefixed URLs | 🔴 High | Code grep in `tournaments/[id]/layout.tsx`, `player/[id]/layout.tsx`, `match/[id]/layout.tsx` + curl confirming `<link rel="canonical">` points to English path on `/fr/tournaments/…` URL |
| Tournament page title hardcoded English (`${name} — Results & Live Scores`) on all locale variants | 🔴 High | Source read of tournament layout + curl on `/fr/tournaments/33eb273e-…` (167 impr/day, 0 clicks) |
| Same hardcoded-English title bug on player + match pages | 🟡 Medium | Source read |
| Sitemap-static lists BOTH `/` and `/home` × 5 locales = 10 home URLs | 🟡 Medium | `src/app/sitemap-static.xml/route.ts` source |
| `src/app/[locale]/(app)/about/page.tsx:41` hardcoded `href="/home"` instead of locale-aware | 🟢 Low | Code grep |
| Vercel dashboard contains a `/` → `/v3` redirect (NOT in vercel.json) | 🟡 Medium | curl on `/` returns 308 with `refresh: 0;url=/v3` header signature; no source-code match |
| Google has chosen `/`, `/es`, `/pt`, etc. as canonical home URLs — overriding our `/home` declarations | (informational) | GSC URL Inspection: `/` verdict=PASS canonical=`/`; `/home` verdict="Page with redirect" canonical=`/` |

---

## File map

```
src/
  app/
    [locale]/
      page.tsx                                  # MODIFY: locale-aware redirect (Task 1)
      (app)/
        about/page.tsx                          # MODIFY: replace href="/home" (Task 4)
        tournaments/[id]/layout.tsx             # MODIFY: pass locale + localize title (Tasks 2 & 3)
      player/[id]/layout.tsx                    # MODIFY: pass locale + localize title (Tasks 2 & 3)
      match/[id]/layout.tsx                     # MODIFY: pass locale + localize title (Tasks 2 & 3)
    sitemap-static.xml/route.ts                 # MODIFY: drop /home, keep / only (Task 5)
  i18n/
    navigation.ts                               # (already exports locale-aware redirect)
  lib/
    seo-helpers.ts                              # (already supports locale arg)
  messages/
    en.json                                     # MODIFY: add seo.tournament/player/match.title keys
    es.json                                     # MODIFY: same, in Spanish
    pt.json                                     # MODIFY: same, in Portuguese
    it.json                                     # MODIFY: same, in Italian
    fr.json                                     # MODIFY: same, in French

# Out of scope for this plan (deferred to follow-up if needed):
# - Vercel Dashboard /→/v3 redirect removal (operator action, no code)
# - Strategy A architectural move (move home content from [locale]/(app)/home/page.tsx
#   to [locale]/page.tsx). Significantly larger refactor; ship after observing the
#   impact of Tasks 1-5 for 2-3 weeks.
```

Why these files specifically: the live-HTML audit identified the exact source files emitting each broken meta. No new files are created; each is a surgical edit to an existing template.

---

## Task 1: Locale-aware redirect on `[locale]/page.tsx`

**Severity:** 🔴 Highest-impact fix in this plan. Unblocks Spanish/Portuguese/Italian/French search traffic capture, which is roughly 60% of global padel search volume.

**Files:**
- Modify: `src/app/[locale]/page.tsx` (entire 7-line file is being changed)

**Verification approach:** No unit test — Next.js redirects are hard to test in isolation and the change is a single import swap. We verify via curl against the preview deployment (or local dev) confirming each locale root redirects to its own locale's `/home`.

- [ ] **Step 1: Read the current file**

```bash
cat src/app/\[locale\]/page.tsx
```
Expected output (the broken state):
```typescript
import { redirect } from 'next/navigation'

// Root page for each locale — redirects to /home
// e.g. / → /home, /es → /es/home
export default function LocaleRoot() {
  redirect('/home')
}
```

- [ ] **Step 2: Apply the fix**

Replace the file contents with:

```typescript
// src/app/[locale]/page.tsx
// Each locale's root URL ("/", "/es", "/pt", "/it", "/fr") redirects to that
// locale's /home. We use the locale-aware `redirect` from src/i18n/navigation
// so /es resolves to /es/home, /pt to /pt/home, etc. Using the bare redirect
// from 'next/navigation' (a previous bug) sends every locale to literal
// /home, which drops the locale and lands the user on English content —
// fatal for SEO in non-English markets.

import { redirect } from '@/i18n/navigation'

export default function LocaleRoot() {
  redirect('/home')
}
```

- [ ] **Step 3: Run typecheck + lint to confirm the import resolves**

```bash
npm run lint -- src/app/\[locale\]/page.tsx
```
Expected: no errors related to this file.

- [ ] **Step 4: Run the test suite (no new tests, but ensure nothing else broke)**

```bash
npx vitest run
```
Expected: same number of passing tests as before the change.

- [ ] **Step 5: Verify in local dev**

```bash
npm run dev &
DEV_PID=$!
sleep 3

# Helper to inspect status + location
probe () {
  /usr/bin/curl -sI --max-time 5 "http://localhost:3002$1" \
    | /usr/bin/grep -iE '^(HTTP|location):' \
    | tr -d '\r'
}

for path in / /es /pt /it /fr; do
  echo "--- $path ---"
  probe "$path"
done

kill $DEV_PID
```

Expected output (the fixed behaviour):
```
--- / ---
HTTP/1.1 307 Temporary Redirect
location: /home
--- /es ---
HTTP/1.1 307 Temporary Redirect
location: /es/home
--- /pt ---
HTTP/1.1 307 Temporary Redirect
location: /pt/home
--- /it ---
HTTP/1.1 307 Temporary Redirect
location: /it/home
--- /fr ---
HTTP/1.1 307 Temporary Redirect
location: /fr/home
```

Each locale must redirect to its OWN locale's `/home`. If `/es` still goes to `/home`, the import wasn't actually swapped — re-check.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/page.tsx
git commit -m "fix(seo): locale-aware redirect on [locale]/page.tsx

Replaces redirect from next/navigation with the locale-aware version
from @/i18n/navigation, so /es → /es/home (not /home), /pt → /pt/home,
etc. The previous bare redirect dropped the locale on every entry-point
visit, landing Spanish/Italian/Portuguese/French visitors on English
content and breaking hreflang reciprocity from Google's perspective."
```

---

## Task 2: Pass `locale` to `buildAlternates` on entity layouts

**Severity:** 🔴 High. Without this, locale-prefixed URLs (`/fr/tournaments/X`, `/es/player/Y`, `/it/match/Z`) emit `<link rel="canonical">` pointing to the *English* URL — telling Google the locale variants are duplicates of English. Combined with Task 1, this is what Google needs to properly attribute traffic to locale URLs.

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/layout.tsx` (line ~65)
- Modify: `src/app/[locale]/player/[id]/layout.tsx` (line ~48)
- Modify: `src/app/[locale]/match/[id]/layout.tsx` (line ~139)

Each has the same pattern: a `generateMetadata({ params })` function that destructures `{ id, locale }` from params but only passes `id` to `buildAlternates`. The `locale` is sitting right there, just not being used.

- [ ] **Step 1: Confirm the bug exists on all three files**

```bash
/usr/bin/grep -n "buildAlternates(\`/" \
  src/app/\[locale\]/\(app\)/tournaments/\[id\]/layout.tsx \
  src/app/\[locale\]/player/\[id\]/layout.tsx \
  src/app/\[locale\]/match/\[id\]/layout.tsx
```
Expected output (the broken state — note no `locale` arg):
```
src/app/[locale]/(app)/tournaments/[id]/layout.tsx:65:    ...buildAlternates(`/tournaments/${id}`),
src/app/[locale]/player/[id]/layout.tsx:48:    ...buildAlternates(`/player/${id}`),
src/app/[locale]/match/[id]/layout.tsx:139:    ...buildAlternates(`/match/${id}`),
```

- [ ] **Step 2: Verify each `generateMetadata` already destructures `locale`**

```bash
/usr/bin/grep -nB 1 "buildAlternates" \
  src/app/\[locale\]/\(app\)/tournaments/\[id\]/layout.tsx \
  src/app/\[locale\]/player/\[id\]/layout.tsx \
  src/app/\[locale\]/match/\[id\]/layout.tsx | /usr/bin/grep -E "const.*locale|await params"
```
Expected: each file destructures `locale` from `await params` somewhere above the `buildAlternates` call. If a file destructures `id` but not `locale`, that destructure needs to be widened first.

- [ ] **Step 3: Apply the fix to the tournament layout**

In `src/app/[locale]/(app)/tournaments/[id]/layout.tsx` find the line:
```typescript
    ...buildAlternates(`/tournaments/${id}`),
```

Change to:
```typescript
    ...buildAlternates(`/tournaments/${id}`, locale),
```

(`locale` is already in scope from the `await params` destructure earlier in the function.)

- [ ] **Step 4: Apply the same fix to the player layout**

In `src/app/[locale]/player/[id]/layout.tsx` find the line:
```typescript
    ...buildAlternates(`/player/${id}`),
```

Change to:
```typescript
    ...buildAlternates(`/player/${id}`, locale),
```

- [ ] **Step 5: Apply the same fix to the match layout**

In `src/app/[locale]/match/[id]/layout.tsx` find the line:
```typescript
    ...buildAlternates(`/match/${id}`),
```

Change to:
```typescript
    ...buildAlternates(`/match/${id}`, locale),
```

- [ ] **Step 6: If any of the three files didn't already destructure `locale` from params, add it**

The destructure pattern in `generateMetadata` should look like:
```typescript
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, locale } = await params
  // ...
}
```

If a file has `const { id } = await params` (no locale), change it to `const { id, locale } = await params`.

- [ ] **Step 7: Run typecheck**

```bash
npm run lint -- \
  src/app/\[locale\]/\(app\)/tournaments/\[id\]/layout.tsx \
  src/app/\[locale\]/player/\[id\]/layout.tsx \
  src/app/\[locale\]/match/\[id\]/layout.tsx
```
Expected: no new errors. If `'locale' is declared but never used` appears anywhere, it means the file destructures `locale` but doesn't pass it to `buildAlternates` yet — re-check Step 3-5.

- [ ] **Step 8: Verify in local dev**

```bash
npm run dev &
DEV_PID=$!
sleep 3

# Pick any real locale-prefixed URL — using the FR tournament from the GSC investigation
/usr/bin/curl -s --max-time 5 "http://localhost:3002/fr/tournaments/33eb273e-1c29-475e-ac43-efaf7d01b915" \
  | /usr/bin/grep -oE '<link rel="canonical" href="[^"]+"' \
  | /usr/bin/head -1

kill $DEV_PID
```
Expected: `<link rel="canonical" href="http://localhost:3002/fr/tournaments/33eb273e-1c29-475e-ac43-efaf7d01b915"` (NOT the English URL).

If it still shows `/tournaments/...` without `/fr/`, the locale didn't make it through. Recheck Step 3.

Repeat the curl for an `/es/player/...` and `/it/match/...` URL to confirm all three layouts work.

- [ ] **Step 9: Commit**

```bash
git add src/app/\[locale\]/\(app\)/tournaments/\[id\]/layout.tsx \
        src/app/\[locale\]/player/\[id\]/layout.tsx \
        src/app/\[locale\]/match/\[id\]/layout.tsx
git commit -m "fix(seo): pass locale to buildAlternates on entity layouts

tournament/player/match layouts were calling buildAlternates(path)
without the locale arg, so the canonical link on a locale-prefixed URL
like /fr/tournaments/X pointed to the *English* URL. Google read this
as 'this French URL is a duplicate of English' and consolidated index
signals away from the locale variants.

Now buildAlternates(path, locale) produces self-referential canonicals
that match the URL the visitor actually loaded."
```

---

## Task 3: Localize entity page titles (tournament, player, match)

**Severity:** 🔴 High. The FR tournament page currently emits `<title>FIP BRONZE DAKAR — Results & Live Scores</title>` — English on a French URL. The French SERP shows a mismatched-language snippet to French searchers, who click competitors. This is the direct cause of the 0% CTR on top zero-click pages identified in the investigation.

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/layout.tsx` (the hardcoded `title` strings near the bottom of `generateMetadata`)
- Modify: `src/app/[locale]/player/[id]/layout.tsx` (same pattern)
- Modify: `src/app/[locale]/match/[id]/layout.tsx` (same pattern)
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

Strategy: introduce ICU-style translation keys under `seo.entity.title` and `seo.entity.description`, then use `getTranslations` in the metadata functions.

- [ ] **Step 1: Read the existing tournament title strings (so we know what English to translate)**

```bash
/usr/bin/grep -nA 1 "const title = " src/app/\[locale\]/\(app\)/tournaments/\[id\]/layout.tsx \
                                       src/app/\[locale\]/player/\[id\]/layout.tsx \
                                       src/app/\[locale\]/match/\[id\]/layout.tsx
```
Expected lines (the templates we're replacing):
```typescript
// tournament:
const title = `${tournament.name} — Results & Live Scores`
const description = `Follow ${tournament.name} live. Scores, rankings and highlights.`

// player (likely):
const title = `${player.name} — Padel Player Profile`
const description = `${player.name}'s career stats, recent matches, rankings.`

// match (likely):
const title = `${pair1} vs ${pair2} — ${tournament.name} Live`
const description = `${pair1} vs ${pair2} live scores at ${tournament.name}.`
```

(The actual player and match templates may differ — read the files to confirm exact wording before translating.)

- [ ] **Step 2: Add SEO translation keys to `src/messages/en.json`**

Find the existing top-level object (the JSON root). Add a `seo` section (or extend it if it already exists):

```json
{
  "seo": {
    "tournament": {
      "title": "{name} — Results & Live Scores",
      "description": "Follow {name} live. Scores, rankings and highlights."
    },
    "player": {
      "title": "{name} — Padel Player Profile",
      "description": "{name}'s career stats, recent matches, rankings."
    },
    "match": {
      "title": "{pair1} vs {pair2} — {tournament} Live",
      "description": "{pair1} vs {pair2} live scores at {tournament}."
    }
  }
}
```

(If `seo` already exists in en.json, merge these keys into it without disturbing existing keys.)

- [ ] **Step 3: Add Spanish translations to `src/messages/es.json`**

Add the same `seo` block, translated:
```json
{
  "seo": {
    "tournament": {
      "title": "{name} — Resultados y marcadores en directo",
      "description": "Sigue {name} en directo. Resultados, clasificación y highlights."
    },
    "player": {
      "title": "{name} — Perfil del jugador",
      "description": "Estadísticas, partidos recientes y clasificación de {name}."
    },
    "match": {
      "title": "{pair1} vs {pair2} — {tournament} en directo",
      "description": "Marcador en directo de {pair1} vs {pair2} en {tournament}."
    }
  }
}
```

- [ ] **Step 4: Add Portuguese translations to `src/messages/pt.json`**

```json
{
  "seo": {
    "tournament": {
      "title": "{name} — Resultados ao vivo e placar",
      "description": "Acompanhe {name} ao vivo. Placar, ranking e melhores momentos."
    },
    "player": {
      "title": "{name} — Perfil do jogador",
      "description": "Estatísticas, partidas recentes e ranking de {name}."
    },
    "match": {
      "title": "{pair1} vs {pair2} — {tournament} ao vivo",
      "description": "Placar ao vivo de {pair1} vs {pair2} em {tournament}."
    }
  }
}
```

- [ ] **Step 5: Add Italian translations to `src/messages/it.json`**

```json
{
  "seo": {
    "tournament": {
      "title": "{name} — Risultati e punteggi in diretta",
      "description": "Segui {name} in diretta. Risultati, classifica e highlights."
    },
    "player": {
      "title": "{name} — Profilo giocatore",
      "description": "Statistiche, partite recenti e classifica di {name}."
    },
    "match": {
      "title": "{pair1} vs {pair2} — {tournament} in diretta",
      "description": "Punteggio in diretta di {pair1} vs {pair2} a {tournament}."
    }
  }
}
```

- [ ] **Step 6: Add French translations to `src/messages/fr.json`**

```json
{
  "seo": {
    "tournament": {
      "title": "{name} — Résultats et scores en direct",
      "description": "Suivez {name} en direct. Scores, classement et temps forts."
    },
    "player": {
      "title": "{name} — Profil du joueur",
      "description": "Statistiques, derniers matchs et classement de {name}."
    },
    "match": {
      "title": "{pair1} vs {pair2} — {tournament} en direct",
      "description": "Score en direct de {pair1} vs {pair2} à {tournament}."
    }
  }
}
```

- [ ] **Step 7: Update tournament layout to use the translation**

In `src/app/[locale]/(app)/tournaments/[id]/layout.tsx`, near the top of the file add:
```typescript
import { getTranslations } from 'next-intl/server'
```

(If it's already imported, skip this line.)

Then in `generateMetadata`, replace:
```typescript
const title = `${tournament.name} — Results & Live Scores`
const description = `Follow ${tournament.name} live. Scores, rankings and highlights.`
```

with:
```typescript
const t = await getTranslations({ locale, namespace: 'seo.tournament' })
const title = t('title', { name: tournament.name })
const description = t('description', { name: tournament.name })
```

Note: `locale` must be in scope — already done in Task 2 Step 6.

- [ ] **Step 8: Update player layout the same way**

In `src/app/[locale]/player/[id]/layout.tsx`, add the `getTranslations` import (if missing), then replace the hardcoded `title`/`description` strings with:
```typescript
const t = await getTranslations({ locale, namespace: 'seo.player' })
const title = t('title', { name: player.name })
const description = t('description', { name: player.name })
```

(Adjust the variable name `player.name` to whatever the actual local variable is in that file.)

- [ ] **Step 9: Update match layout the same way**

In `src/app/[locale]/match/[id]/layout.tsx`:
```typescript
const t = await getTranslations({ locale, namespace: 'seo.match' })
const title = t('title', {
  pair1: pairLabel(match.pair1_player1, match.pair1_player2),
  pair2: pairLabel(match.pair2_player1, match.pair2_player2),
  tournament: tournament?.name ?? '',
})
const description = t('description', {
  pair1: pairLabel(match.pair1_player1, match.pair1_player2),
  pair2: pairLabel(match.pair2_player1, match.pair2_player2),
  tournament: tournament?.name ?? '',
})
```

(Use whatever helper or property names actually compose the pair labels in the existing match layout — read the surrounding code to match its conventions.)

- [ ] **Step 10: Run typecheck**

```bash
npm run lint -- src/app/\[locale\]/\(app\)/tournaments/\[id\]/layout.tsx \
                src/app/\[locale\]/player/\[id\]/layout.tsx \
                src/app/\[locale\]/match/\[id\]/layout.tsx \
                src/messages/*.json
```
Expected: no errors. Next-intl with TypeScript will fail at this step if translation keys are missing in any of the 5 locale files — that's a feature, not a bug.

- [ ] **Step 11: Verify in local dev — French tournament page**

```bash
npm run dev &
DEV_PID=$!
sleep 3

/usr/bin/curl -s --max-time 5 "http://localhost:3002/fr/tournaments/33eb273e-1c29-475e-ac43-efaf7d01b915" \
  | /usr/bin/grep -oE '<title>[^<]+</title>|<meta name="description" content="[^"]+"' \
  | /usr/bin/head -2

kill $DEV_PID
```
Expected output:
```
<title>FIP BRONZE DAKAR — Résultats et scores en direct</title>
<meta name="description" content="Suivez FIP BRONZE DAKAR en direct. Scores, classement et temps forts."
```

If the title is still in English, the metadata function is still using hardcoded strings — re-check Steps 7-9.

- [ ] **Step 12: Verify Spanish + Italian + Portuguese variants of the same kind of page**

Run the same curl for `/es/tournaments/...`, `/it/tournaments/...`, `/pt/tournaments/...` (use any existing tournament UUID). Confirm each shows its locale's title.

- [ ] **Step 13: Commit**

```bash
git add src/app/\[locale\]/\(app\)/tournaments/\[id\]/layout.tsx \
        src/app/\[locale\]/player/\[id\]/layout.tsx \
        src/app/\[locale\]/match/\[id\]/layout.tsx \
        src/messages/en.json src/messages/es.json src/messages/pt.json \
        src/messages/it.json src/messages/fr.json
git commit -m "fix(seo): localize tournament/player/match page titles

Previously every locale variant emitted English titles like
'FIP BRONZE DAKAR — Results & Live Scores' regardless of which locale
URL was loaded. French/Italian/Portuguese/Spanish SERP snippets showed
mismatched-language text and got 0% CTR despite ranking on page 1.

Adds seo.{tournament,player,match}.{title,description} translation
keys to all 5 message files, then wires generateMetadata in the three
entity layouts to read from them via getTranslations(). Confirmed
locally that /fr/tournaments/<id> now emits 'Résultats et scores en
direct' in the title."
```

---

## Task 4: Fix hardcoded `/home` link in about page

**Severity:** 🟢 Low — a single internal link. Includes because it's a 30-second fix and it's the only hardcoded `/home` in the entire UI.

**Files:**
- Modify: `src/app/[locale]/(app)/about/page.tsx` (line ~41)

The back-button on the About page uses `<Link href="/home">` from `next/link` directly. On the Spanish about page (`/es/about`), this Link sends the user to literal `/home` (English) instead of `/es/home`. After Task 1 lands, this won't actively break anything (the `/home` redirect now preserves locale via `[locale]/page.tsx`), but the click-then-redirect adds an unnecessary navigation hop. Fix at source.

- [ ] **Step 1: Read the current import and usage**

```bash
/usr/bin/grep -nE "^import.*Link|href=\"/home\"" src/app/\[locale\]/\(app\)/about/page.tsx
```
Expected:
```typescript
import Link from 'next/link'
// ...
          href="/home"
```

- [ ] **Step 2: Change the import to use the locale-aware Link**

In `src/app/[locale]/(app)/about/page.tsx`, change:
```typescript
import Link from 'next/link'
```

to:
```typescript
import { Link } from '@/i18n/navigation'
```

The locale-aware `Link` from `@/i18n/navigation` has the same API as next/link but automatically prepends the active locale prefix when needed.

- [ ] **Step 3: Verify the `href="/home"` no longer drops locale**

```bash
npm run dev &
DEV_PID=$!
sleep 3

# Load the Spanish about page and check the back-button's resolved href
/usr/bin/curl -s --max-time 5 "http://localhost:3002/es/about" \
  | /usr/bin/grep -oE 'href="/es?/home"' \
  | /usr/bin/head -1

kill $DEV_PID
```

Expected: `href="/es/home"`. (Next.js with next-intl renders the locale-aware Link's resolved URL.)

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/\(app\)/about/page.tsx
git commit -m "fix(seo): about-page back link uses locale-aware Link

Replaces 'next/link' with @/i18n/navigation's Link. The bare href='/home'
combined with the bare Link previously rendered as a literal /home href
regardless of active locale, sending Spanish/etc. about-page visitors
back to the English home. The i18n Link auto-prefixes the active
locale, so /es/about's back-button now resolves to /es/home."
```

---

## Task 5: Dedupe `/home` from sitemap-static.xml

**Severity:** 🟡 Medium. The sitemap currently declares both `/` AND `/home` (× 5 locales each) as canonical URLs for the same content. Google has independently decided `/` is the canonical version. Listing both confuses our submitted URL set vs Google's chosen index, which dilutes crawl signal.

**Files:**
- Modify: `src/app/sitemap-static.xml/route.ts` (the `paths` array near line 22)

After this task, the home page is represented once per locale via the bare locale-root URL (`https://padelnachos.com`, `https://padelnachos.com/es`, etc.) which matches what Google already chose to index.

**Important:** This task does NOT remove `/home` from the application or any redirect. `/home` continues to serve content for legacy bookmarks and direct visits. We're only removing it from the sitemap because Google views it as a duplicate of `/`.

- [ ] **Step 1: Read the current sitemap source**

```bash
/usr/bin/cat src/app/sitemap-static.xml/route.ts
```
Confirm the `paths` array contains both `'/' ` and `'/home'`:
```typescript
const paths: Array<{...}> = [
  { path: '/',        changefreq: 'always', priority: 1.0 },
  { path: '/home',    changefreq: 'always', priority: 1.0 },
  { path: '/matches', changefreq: 'always', priority: 0.9 },
  ...
]
```

- [ ] **Step 2: Apply the fix**

In `src/app/sitemap-static.xml/route.ts`, remove the `{ path: '/home', ... }` line from the `paths` array. The result should look like:

```typescript
  const paths: Array<{
    path: string
    changefreq: SitemapUrl['changefreq']
    priority: number
  }> = [
    { path: '/', changefreq: 'always', priority: 1.0 },
    // /home intentionally absent — Google canonicalized to '/' and listing
    // both URLs in the sitemap was diluting the signal. See
    // docs/superpowers/plans/2026-05-26-technical-seo-sweep.md Task 5.
    { path: '/matches', changefreq: 'always', priority: 0.9 },
    { path: '/rankings', changefreq: 'daily', priority: 0.8 },
    { path: '/feed', changefreq: 'hourly', priority: 0.7 },
    { path: '/about', changefreq: 'weekly', priority: 0.4 },
  ]
```

- [ ] **Step 3: Verify the new sitemap output locally**

```bash
npm run dev &
DEV_PID=$!
sleep 3

/usr/bin/curl -s --max-time 5 "http://localhost:3002/sitemap-static.xml" \
  | /usr/bin/grep -oE '<loc>[^<]+</loc>' \
  | /usr/bin/sort -u

kill $DEV_PID
```

Expected output (one URL per home variant — bare locale roots only):
```
<loc>https://padelnachos.com</loc>
<loc>https://padelnachos.com/es</loc>
<loc>https://padelnachos.com/pt</loc>
<loc>https://padelnachos.com/it</loc>
<loc>https://padelnachos.com/fr</loc>
<loc>https://padelnachos.com/matches</loc>
<loc>https://padelnachos.com/es/matches</loc>
... (rest of matches/rankings/feed/about per locale)
```

There should be NO `https://padelnachos.com/home` or `/es/home` etc. in the output.

- [ ] **Step 4: Commit**

```bash
git add src/app/sitemap-static.xml/route.ts
git commit -m "fix(seo): drop /home from sitemap-static (Google chose / as canonical)

GSC URL Inspection on https://padelnachos.com/home reports
coverageState='Page with redirect' and googleCanonical='https://padelnachos.com/'.
On every locale variant the same — Google picked the bare locale root as
canonical and treats /home as a duplicate. Listing both forms in the
sitemap competed against ourselves for crawl budget.

The /home URLs continue to serve content for direct visits and legacy
bookmarks. They just no longer appear in the sitemap.

After deploy, resubmit sitemap.xml in GSC and watch the URL Inspection
verdict on / and /es to confirm 'Submitted and indexed' (already PASS
per the day-of-investigation probe)."
```

---

## Task 6: Operator-side actions in Google Search Console

**Severity:** 🟢 Operator action — no code. Speeds up Google's re-evaluation of pages we just changed.

These are click-paths inside https://search.google.com/search-console, not commits. List them so the operator has a checklist after the code PRs deploy.

- [ ] **Step 1: After all code PRs are deployed, resubmit the sitemap**

Path: GSC → Sitemaps → enter `sitemap.xml` → Submit.

Expected: status changes to "Pending" then "Success" within ~5 min.

- [ ] **Step 2: Request indexing for `/fr/home`**

GSC URL Inspection currently reports this URL as "URL is unknown to Google". After Task 1 deploys, `/fr/home` is reachable via `/fr` → `/fr/home` redirect.

Path: GSC → URL Inspection → paste `https://padelnachos.com/fr/home` → "Request indexing".

Expected: "Indexing requested" confirmation. Google will crawl within 24-72h.

- [ ] **Step 3: Request indexing for one tournament page after Task 3 deploys**

Pick a high-impression locale tournament URL — e.g. `https://padelnachos.com/fr/tournaments/33eb273e-1c29-475e-ac43-efaf7d01b915` (had 167 impr/day with 0 clicks). The page now has a French title.

Path: GSC → URL Inspection → paste the URL → "Test live URL" → confirm the new French title shows in the rendered HTML → "Request indexing".

- [ ] **Step 4: Request indexing for the locale roots**

Same path, for each of: `https://padelnachos.com/`, `https://padelnachos.com/es`, `https://padelnachos.com/pt`, `https://padelnachos.com/it`, `https://padelnachos.com/fr`.

Each is already indexed per the investigation, but requesting indexing forces a recrawl that picks up the new sitemap structure faster than waiting for Google's normal cycle.

- [ ] **Step 5: Watch the SEO dashboard daily for ~2 weeks**

https://admin.padelnachos.com/system/seo — once a day, confirm:
- Locale clicks (es/pt/it/fr rows) trending up
- Top zero-CTR tournament pages dropping out of the Opportunities → Rank Candidates list (the bad titles being replaced means CTR rises)
- "In GSC, not in sitemap" Opportunities row shrinking (recrawl picks up the new sitemap)

No commit — this is a watch-and-wait step. Document observations in a follow-up note if the metrics don't move in the expected direction within 3 weeks.

---

## Out-of-scope (deferred follow-ups)

### Strategy A — Move home content from `[locale]/(app)/home/page.tsx` to `[locale]/page.tsx`

After Tasks 1-5 ship and we observe 2-3 weeks of GSC data, consider whether to fully eliminate the redirect chain (`/` → `/v3` → `/home`) by:
1. Having the operator remove the Vercel-Dashboard `/` → `/v3` redirect
2. Moving home content from `[locale]/(app)/home/page.tsx` to `[locale]/page.tsx` so `/`, `/es`, etc. render directly (no redirect)
3. Keeping `/home` reachable via a single `/home` → `/` redirect in `next.config.ts` for legacy bookmarks

This is intentionally not in this plan because:
- It's a bigger refactor — moving a page outside the `(app)` route group may lose shared layout/auth scope; needs investigation first
- Tasks 1-5 may already deliver enough improvement that the architectural move isn't worth the risk
- The Vercel Dashboard redirect removal is invisible-to-source and creates a coordination footgun

Open a separate plan when this becomes priority.

### Vercel Dashboard redirect audit

Independently of Strategy A: audit the Vercel project Settings → Redirects for any other dashboard-level rules that aren't reflected in `vercel.json`. Each found should either be moved into `vercel.json` (visible in source) or deleted if obsolete. The `/` → `/v3` rule is one we found; there may be others.

---

## Acceptance criteria for this plan

After all six tasks ship:

- [ ] `curl https://padelnachos.com/es -I` returns `307` with `location: /es/home`. Same for `/pt`, `/it`, `/fr`.
- [ ] `curl https://padelnachos.com/fr/tournaments/<existing-id>` returns HTML containing `<title>… Résultats et scores en direct</title>` (French).
- [ ] `curl https://padelnachos.com/fr/tournaments/<existing-id>` returns HTML containing `<link rel="canonical" href="https://padelnachos.com/fr/tournaments/<existing-id>"/>` (locale-correct canonical, NOT the English URL).
- [ ] `curl https://padelnachos.com/sitemap-static.xml` does NOT contain the substring `/home` for any locale.
- [ ] All 25 existing `apps/ops` tests still pass.
- [ ] All existing `src/lib/__tests__/*.test.ts` tests still pass.
- [ ] GSC URL Inspection on `/fr/home` no longer shows "URL is unknown to Google" (after operator manual request + 24-72h).
- [ ] The Opportunities tab at https://admin.padelnachos.com/system/seo/opportunities shows the "In GSC, not in sitemap" list shrinking week-over-week as Google recrawls.

---

## Effort estimate

| Task | Estimated time |
|---|---|
| Task 1 (locale-aware redirect) | 15 min |
| Task 2 (buildAlternates locale arg ×3) | 30 min |
| Task 3 (localize titles + 5 message files) | 1.5 hours |
| Task 4 (about-page Link import) | 5 min |
| Task 5 (sitemap dedup) | 10 min |
| Task 6 (operator GSC actions) | 15 min (over multiple browser tabs) |
| Verification + curl checks + commit messages | 30 min |
| **Total** | **~3 hours of focused work, plus 2-3 weeks of observation** |
