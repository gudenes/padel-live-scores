-- ops_docs: small key-value store for operator-editable reference docs
-- (coverage capability matrix in v1; future docs are row inserts).
--
-- Auth model: the API route at /api/ops/docs/[slug] guards access via
-- the existing ops_token cookie (checkOpsAuth) + uses the service-role
-- key for the actual SELECT / UPSERT, bypassing RLS. We still enable
-- RLS as defence-in-depth so the anon key can never read or write,
-- even if the route's auth check were ever bypassed.

create table if not exists public.ops_docs (
  slug         text primary key,
  content      text not null,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

alter table public.ops_docs enable row level security;

-- No policies for anon / authenticated. Service-role key bypasses RLS.
-- (Intentional — same pattern as our other ops-only tables.)

-- updated_at maintenance
create or replace function public.ops_docs_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger ops_docs_updated_at_trigger
  before update on public.ops_docs
  for each row execute function public.ops_docs_set_updated_at();

-- Seed the coverage matrix.
insert into public.ops_docs (slug, content, updated_by)
values (
  'coverage-matrix',
  $matrix$# PadelNachos coverage capability matrix

Last updated: 2026-05-20 — seeded version. Edit freely via this page.

---

## A. Active tournament levels

| Level | Source mix | Status |
|---|---|---|
| `finals` | mixed | Premier Padel — top circuit |
| `major` | mostly FIP-discovered | Premier Padel |
| `p1` | FIP-discovered | Premier Padel |
| `p2` | FIP-discovered | Premier Padel |
| `fip_platinum` | FIP-discovered | FIP Pro Tour |
| `fip_gold` | FIP-discovered | FIP Pro Tour |
| `fip_silver` | FIP-discovered | FIP Pro Tour |
| `fip_bronze` | FIP-discovered | FIP Pro Tour |
| `fip_championship` | FIP-discovered | FIP Marquee |
| `fip_promises` | FIP-discovered | FIP Development (junior) |
| `fip_beyond` | FIP-discovered | FIP Development (amateur) |
| `fip_other` | mixed | FIP catch-all |
| `wpt_*` | padelapi-historical | Legacy — circuit dissolved |
| `fip_hexagon` / `fip_star` / `fip_rise` / `fip_promotion` / `fip_finals` | — | Schema reserved, never seen |

## B. Capability matrix

Legend: ● automated production · ◐ partial / has known gaps · ○ manual-ops only · ✕ not available

| Capability | Premier (finals/major/p1/p2) | FIP Pro Tour (platinum→bronze) | FIP Championship | FIP Promises | FIP Beyond | WPT legacy |
|---|---|---|---|---|---|---|
| Discovery (tournament exists in DB) | ● | ● | ● | ● | ● | ○ history |
| Metadata — name, dates, country, level | ● | ● | ● | ● | ● | ○ |
| Venue — name + address | ● | ◐ | ◐ | ◐ | ✕ usually | ○ |
| Prize money | ● | ● | ● | ◐ | ✕ | ○ |
| Logo + cover image | ● | ● | ● | ● | ◐ | ○ |
| Entry list — players + pairs | ● | ● HTML+PDF | ● | ● | ◐ thin names | ✕ |
| Draw / bracket — FIP HTML AJAX | ● | ● when published | ● | ● | ◐ | ✕ |
| Draw / bracket — FIP PDF, manual ops upload | ● | ● | ● | ● | ● | n/a |
| Draw / bracket — FIP PDF, automated download | ✕ gap | ✕ gap | ✕ gap | ✕ gap | ✕ gap | n/a |
| Matches — bootstrap from OOP when no draw | ● | ● *(shipped 2026-05-19)* | ● | ● | ● | ✕ |
| OOP — court + day + label | ● | ● | ● | ● | ◐ | ✕ |
| Schedule — parsed `scheduled_at` UTC | ● | ● when OOP present | ● | ● | ◐ | ✕ |
| Live state — scheduled → live → finished | ● Pusher relay + Crionet poll | ● OOP + results sweep | ● | ● | ◐ | ✕ |
| Live point-by-point — per-point feed | ● Crionet live-poller-loop | ✕ Crionet doesn't expose | ✕ | ✕ | ✕ | ✕ |
| Live momentum chart (PBP-derived) | ● | ✕ | ✕ | ✕ | ✕ | ✕ |
| Final score — set scores + winner | ● | ● fip-results-writer | ● | ● | ◐ | historical only |
| Match stats — Crionet `getmatchstats` | ● Premier-tier only | ✕ | ✕ | ✕ | ✕ | ✕ |
| Push notifications — live start | ● with score updates | ● status-only | ● | ● | ◐ | n/a |
| Push notifications — finish | ● | ● | ● | ● | ◐ | n/a |
| Push largeIcon — avatar / circuit logo | ● padelapi-hosted | ● rehosted padelfip | ● | ● | ◐ | n/a |
| YouTube "Where to watch" | ● broadcaster groups | ● `fip_court_streams` | ● | ◐ | ✕ | n/a |
| Player profiles — ranking, race, history | ◐ above ranking cutoff only | ◐ above ranking cutoff only | ◐ | ◐ | ✕ | static |
| Player avatars in feed/UI | ● padelapi-hosted | ● padelfip rehosted | ● | ◐ | ✕ | static |

## C. Source-of-truth per tier

| Tier | Discovery | Metadata enrich | Entry list | Draw | OOP/Schedule | Live state | Live PBP | Stats | Final |
|---|---|---|---|---|---|---|---|---|---|
| Premier Padel | FIP WP + Premier API | FIP event page | FIP page / PDF | FIP HTML + Crionet draw widget | Crionet OOP widget | padelgod live-poller (Crionet) | padelgod live-poller (Crionet) | padelgod match-stats-fetcher (Crionet) | Crionet results widget |
| FIP Pro Tour | FIP WP API | FIP event page enricher | FIP page + auto-PDF via Sonnet | FIP HTML when published; otherwise ops PDF upload; OOP fallback when neither | Crionet OOP widget | OOP + results sweep | — | — | Crionet results widget |
| FIP Promises / Beyond | FIP WP API | FIP event page | thin / often absent | FIP HTML when published; ops PDF upload; OOP fallback | Crionet OOP widget | OOP + results sweep | — | — | Crionet results widget |
| WPT legacy | historical padelapi | none | none | none | none | none | none | none | snapshot in DB |

Note: padelapi.org is paused (`PADELAPI_PAUSED=true`) — padelgod owns all writes. Premier-tier still gets full coverage because padelgod's live-poller subscribes to Crionet's per-match endpoint, which is exposed for Premier-tier events.

## D. Do not regress

Working capabilities. Any change to draws, OOP, or live coverage must preserve these.

1. **Manual draw PDF upload.** ops UI → `POST src/app/api/ops/parse-draw` → `parseDrawPdfWithSonnet` → `POST src/app/api/ops/seed-draw` → `tournament_draws` rows. `DrawTab` reads `tournament_draws` and overlays markers onto the bracket.
2. **Automated entry-list PDF download.** `src/lib/fip-entry-list-pipeline.ts` — downloads `pdf:` URLs from FIP AJAX, parses with Sonnet, resolves to players. Already production-proven.
3. **Match-identifier pair sanity check.** `padelgod/src/lib/match-identifier.ts` court-only twin matching is gated by an unordered-pair check. Prevents court-swap hijacks (Brussels P2 incident, 2026-04-23).
4. **Schedule-review human approval flow.** Option-A safety: never overwrite a populated player FK; only fill NULLs. Any OOP-driven INSERT path must preserve this when later runs touch the same row.
5. **PBP live-poll subscription budget.** `live-poller-manager` spawns per-match loops, Premier-tier only. Don't widen the gate without budget review.
6. **`PADELAPI_PAUSED` kill-switch.** Currently `true`. Any new worker must NOT take a hard dependency on padelapi.
7. **OOP-as-draw fallback for all FIP tiers** *(shipped 2026-05-19, PR #353)*. `fip-draw-populator` creates thin matches from `oop_snapshots` for any `fip_*` tier when the bracket is empty. Composite-key UPDATE NULL-only enrichment backfills FKs when the bracket later arrives. Premier and WPT remain excluded.

## E. Known gaps

Gaps the matrix exposes today. Each is a candidate for a separate plan.

1. **Automated FIP draw PDF download.** FIP increasingly publishes Pro Tour draws as PDF-only. Entry lists already have this pattern (`fip-entry-list-pipeline.ts`); the same shape ports to draws. Until then, draws need either an FIP AJAX bracket or a manual ops PDF upload to land in `tournament_draws`.
2. **`tournament_draws` → `public.matches` enrichment.** Manual PDF uploads write to `tournament_draws` but `fip-draw-populator` doesn't read from there — so manual uploads enrich the DrawTab UI but don't backfill FKs on existing thin matches in `public.matches`. Fix: have the populator also read `tournament_draws` as an enrichment source.
3. **Entry-list player ranking ingestion.** FIP entry list pages and PDFs include per-player ranking in the source we already scrape, but `fip-entry-list-populator` currently drops the ranking column. Result: players below the public WP-JSON ranking cutoff (e.g. Leonardo Villa P208430, Francesco Carocci P208910 in Latina Q1) end up as bare shells in `players` with NULL `ranking` even though the data was visible upstream. Fix: extend the populator's player-row UPSERT to include ranking, gated through `filterUpdateByPriority` so it only fills NULLs when the WP-JSON-sourced cron hasn't already won the field.
4. **Player-profile worker isn't attempting low-ranked players.** `profile_attempt_at` is still epoch on shell rows. There's likely a gate in the `player-profile` worker excluding players with no ranking. Worth investigating once gap #3 is fixed.
$matrix$,
  'seed-migration'
)
on conflict (slug) do nothing;
