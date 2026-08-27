# Personalized `match_scheduled` + `player_eliminated` push copy

**Date:** 2026-08-27
**Status:** Approved for implementation
**Branch:** `feat/personalized-scheduled-eliminated`

## Goal

Replace the generic event-notification copy for `match_scheduled` and `player_eliminated` with the same grammar as the live on-court push: **your player's name in the title, the match in the body, their photo as the largeIcon**. Ship the copy in en/es/pt/it/fr. Let ops test it ad-hoc with the photo.

## Product rules

### `match_scheduled`
Fired once when a followed/bookmarked match first gets a firm time + court (`fip-oop-writer`, `ENABLE_EVENT_NOTIFICATIONS`).

- Follow: `{Name} plays at {time}` + avatar
- Bookmark only: `Match scheduled · {time}` + circuit logo
- Body: `{pair} vs {pair} — {court} · {tournament} {round}`

### `player_eliminated` vs `match_finished` ("lost")
These are **not** duplicates:

| | `match_finished` / `{Name} lost` | `player_eliminated` / `{Name} knocked out` |
|---|---|---|
| Sender | Live-poller `closeMatch` → `/api/push/notify` | `fip-results-writer` → `/api/push/notify-event` |
| When | We had live coverage and closed the match | Results widget is the first writer to `finished` |
| Skip | n/a | Writer already skips rows whose status is already terminal — so a live close suppresses knockout |

FIP presence-only (`on_court` without PBP) finishes via the results writer → knocked out. Correct.

### Time for the end user

`matches.scheduled_at` is UTC. The lock-screen string is **not** converted by iOS/Android — we have to format it.

1. **Preferred:** recipient device IANA timezone, captured at push subscribe (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and stored on `native_push_subscriptions.timezone` / `push_subscriptions.timezone` / `anon_push_subscriptions.timezone`. Native already POSTs `locale` on every boot; timezone rides along.
2. **Fallback** (null timezone — every existing subscription until the app is opened once): tournament IANA tz (`tournaments.timezone`) **plus abbreviation**, e.g. `18:00 CEST`. Never a bare `18:00` that silently means Brussels to a user in São Paulo.
3. Clock is **24h** (`18:00`) in every locale — same as the mockups / broadcast convention.
4. If `scheduled_at` is missing: drop the clock (`{Name} is scheduled` / `Match scheduled`).

Locale for copy: `native_push_subscriptions.locale` if set, else `profiles.locale`, else `en`. Anon without locale → `en`.

## Architecture

Composition lives in the **Next.js** `/api/push/notify-event` path (not padelgod). padelgod still fires `notifyEvent` with category + entity + fallback title/body + `metadata.match_id`. The endpoint:

1. Resolves followers as today.
2. For `match_scheduled` / `player_eliminated`, loads the match (players, sets, tournament tz/level/name, round, court, scheduled_at).
3. Resolves which of the 4 players each recipient follows (first follow wins, same as `/api/push/notify`).
4. Per recipient, `composeScheduled` / `composeEliminated` → title, body, icon.
5. In-app row + web push + FCM all use that per-user payload.

Pure composer: `src/lib/push-copy.ts` (tested). i18n via `createTranslator` + a `push` namespace in `messages/{en,es,pt,it,fr}.json` (same pattern as the welcome email).

Gendered knockout in es/pt/it/fr uses `matches.category` (`women` → eliminada / éliminée / eliminata).

## Admin / ops

- `CATEGORY_RULES` samples become the personalized follow variants (with `sampleScenario: 'scheduled_follow' | 'eliminated'`).
- `/api/admin/test-push` gains those scenarios (copy + avatar icon). Existing `premier` / `fip` / `avatar` stay.
- Ops `notify-test` forwards `scenario` + `avatarUrl`.
- Catalog row **Test** sends the sample with the matching scenario so the operator's phone shows the photo.

## Out of scope

- Personalizing `player_entered` / `draw_released` / `player_title_won` (same generic family; not this PR).
- Replacing `match_finished` copy.
- Per-device timezone when one user has two phones in two countries (use any stored tz on their subscriptions; first wins).
