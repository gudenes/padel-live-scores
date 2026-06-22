# Personalized `player_entered` Notification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `player_entered` push show the name + avatar of the player *the recipient follows*, and tap through to that player's page.

**Architecture:** Personalize per-recipient inside the `notify-event` endpoint (opt-in via a `personalizePerFollower` flag), mirroring how `/api/push/notify` personalizes the on-court push. A pure builder computes per-user title/body/icon/url from the players that user follows. The populator change is minimal (pass the flag + `tournamentId`).

**Tech Stack:** Next.js (App Router API route), TypeScript, Supabase JS, Vitest. Padelgod worker (Node/TS).

**Base branch:** This plan MUST be implemented on a fresh worktree off `main` (the brainstorm worktree is 564 commits behind and lacks the `player_entered` feature). See spec "Logistics".

**Spec:** `docs/superpowers/specs/2026-06-22-player-entered-personalized-notification-design.md`

---

## File Structure

- **Create** `src/lib/player-name.ts` — shared `lastName` + `playerLastName` (extracted from the match route).
- **Create** `src/lib/__tests__/player-name.test.ts` — unit tests.
- **Create** `src/lib/player-entered-content.ts` — pure per-user content builder.
- **Create** `src/lib/__tests__/player-entered-content.test.ts` — unit tests.
- **Modify** `src/app/api/push/notify/route.ts` — import shared `playerLastName`/`lastName`, delete local copies.
- **Modify** `padelgod/src/lib/notify.ts` — add `personalizePerFollower?: boolean` to `NotifyEventPayload`.
- **Modify** `padelgod/src/workers/fip-entry-list-populator.ts` — pass `personalizePerFollower: true` + `metadata.tournamentId`.
- **Modify** `padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts` — assert new payload fields.
- **Modify** `src/app/api/push/notify-event/route.ts` — opt-in per-recipient personalization branch.

---

## Task 1: Extract shared `playerLastName` / `lastName`

The match route defines `lastName` and `playerLastName` locally. Extract them so the new content builder reuses one copy.

**Files:**
- Create: `src/lib/player-name.ts`
- Create: `src/lib/__tests__/player-name.test.ts`
- Modify: `src/app/api/push/notify/route.ts` (remove local `lastName`/`playerLastName`, import them)

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/player-name.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lastName, playerLastName } from '../player-name'

describe('lastName', () => {
  it('returns the last whitespace-delimited token', () => {
    expect(lastName('Agustin Tapia')).toBe('Tapia')
  })
  it('returns empty string for null/undefined/empty', () => {
    expect(lastName(null)).toBe('')
    expect(lastName(undefined)).toBe('')
    expect(lastName('   ')).toBe('')
  })
})

describe('playerLastName', () => {
  it('prefers display_name over canonical name', () => {
    expect(playerLastName({ name: 'Gemma Triay Pons', display_name: 'Gemma Triay' })).toBe('Triay')
  })
  it('falls back to name when display_name is null', () => {
    expect(playerLastName({ name: 'Agustin Tapia', display_name: null })).toBe('Tapia')
  })
  it('returns empty string for null player', () => {
    expect(playerLastName(null)).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/player-name.test.ts`
Expected: FAIL — cannot find module `../player-name`.

- [ ] **Step 3: Create the shared lib**

Create `src/lib/player-name.ts`:

```ts
// src/lib/player-name.ts
// Shared player-name helpers used by push-notification routes.
//
// playerLastName reads display_name when set (e.g. "Gemma Triay Pons" →
// display_name "Gemma Triay" → "Triay") so titles use the form fans recognize,
// not the canonical double-surname tail. Falls back to canonical name.

export interface NameabledPlayer {
  name?: string | null
  display_name?: string | null
}

export function lastName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

export function playerLastName(p: NameabledPlayer | null | undefined): string {
  if (!p) return ''
  return lastName(p.display_name?.trim() || p.name)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/player-name.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Update the match route to import the shared helpers**

In `src/app/api/push/notify/route.ts`:

Add to the import block (after line 40, the `resolveNotificationIcon` import):

```ts
import { lastName, playerLastName } from '@/lib/player-name'
```

Then DELETE the two local function definitions (the `lastName` function and the `playerLastName` function, currently around lines 73–86). Leave `PlayerLite`, `buildBody`, and everything else untouched — `PlayerLite` is structurally compatible with `NameabledPlayer` (it has `name` and `display_name`), so existing `playerLastName(p)` calls keep type-checking.

- [ ] **Step 6: Verify type-check + existing behavior**

Run: `npm run lint`
Expected: no errors in `src/app/api/push/notify/route.ts`.

Run: `npx vitest run src/lib/__tests__/player-name.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/player-name.ts src/lib/__tests__/player-name.test.ts src/app/api/push/notify/route.ts
git commit -m "refactor: extract shared playerLastName/lastName to src/lib/player-name"
```

---

## Task 2: Pure per-user content builder

`buildPlayerEnteredContent` takes the players a single user follows that just entered + the tournament, and returns the personalized `{ title, body, icon, url }` — or `null` when no named player is available (caller falls back to generic).

**Files:**
- Create: `src/lib/player-entered-content.ts`
- Create: `src/lib/__tests__/player-entered-content.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/player-entered-content.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPlayerEnteredContent, type EnteredPlayer } from '../player-entered-content'

const tapia: EnteredPlayer = { id: 'p-tapia', name: 'Agustin Tapia', display_name: null, avatar_url: 'https://cdn/tapia.png', ranking: 1 }
const coello: EnteredPlayer = { id: 'p-coello', name: 'Arturo Coello', display_name: null, avatar_url: 'https://cdn/coello.png', ranking: 2 }
const noAvatar: EnteredPlayer = { id: 'p-x', name: 'No Avatar', display_name: null, avatar_url: null, ranking: 5 }
const noName: EnteredPlayer = { id: 'p-y', name: null, display_name: null, avatar_url: null, ranking: 7 }
const premier = { name: 'Madrid P1', level: 'P1' }

describe('buildPlayerEnteredContent', () => {
  it('single player → name + tournament title, avatar icon, player url', () => {
    const c = buildPlayerEnteredContent([tapia], premier)
    expect(c).toEqual({
      title: 'Tapia entered Madrid P1',
      body: 'Just added to the entry list.',
      icon: 'https://cdn/tapia.png',
      url: '/player/p-tapia',
    })
  })

  it('multiple players → "+N more", best-ranked headliner', () => {
    // coello passed first but tapia (ranking 1) is the headliner
    const c = buildPlayerEnteredContent([coello, tapia], premier)
    expect(c?.title).toBe('Tapia +1 more entered Madrid P1')
    expect(c?.body).toBe('Players you follow joined the draw.')
    expect(c?.url).toBe('/player/p-tapia')
    expect(c?.icon).toBe('https://cdn/tapia.png')
  })

  it('headliner without avatar → circuit logo (Premier star)', () => {
    const c = buildPlayerEnteredContent([noAvatar], premier)
    expect(c?.icon).toBe('https://padelnachos.com/branding/premier-padel-star.png')
  })

  it('FIP-tier without avatar → FIP tour icon', () => {
    const c = buildPlayerEnteredContent([noAvatar], { name: 'Vigo Bronze', level: 'fip_bronze' })
    expect(c?.icon).toBe('https://padelnachos.com/branding/fip-tour-icon.png')
  })

  it('drops players with no name; returns null when none remain', () => {
    expect(buildPlayerEnteredContent([noName], premier)).toBeNull()
  })

  it('null tournament name → "an event" fallback', () => {
    const c = buildPlayerEnteredContent([tapia], { name: null, level: 'P1' })
    expect(c?.title).toBe('Tapia entered an event')
  })

  it('null ranking sorts last; alpha tie-break on equal ranking', () => {
    const a: EnteredPlayer = { id: 'a', name: 'Zoe Alpha', display_name: null, avatar_url: null, ranking: null }
    const b: EnteredPlayer = { id: 'b', name: 'Yan Beta', display_name: null, avatar_url: null, ranking: null }
    // both null ranking → alpha by last name: Alpha < Beta
    const c = buildPlayerEnteredContent([b, a], premier)
    expect(c?.url).toBe('/player/a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/player-entered-content.test.ts`
Expected: FAIL — cannot find module `../player-entered-content`.

- [ ] **Step 3: Implement the builder**

Create `src/lib/player-entered-content.ts`:

```ts
// src/lib/player-entered-content.ts
// Pure builder for the personalized `player_entered` push. Given the players a
// single recipient follows that just entered a tournament, returns the
// per-user { title, body, icon, url }. Returns null when no named player is
// available so the caller can fall back to generic copy.

import { playerLastName } from './player-name'
import { resolveNotificationIcon } from './notification-icon'

export interface EnteredPlayer {
  id: string
  name: string | null
  display_name: string | null
  avatar_url: string | null
  ranking: number | null
}

export interface EnteredContent {
  title: string
  body: string
  icon: string
  url: string
}

export function buildPlayerEnteredContent(
  followed: EnteredPlayer[],
  tournament: { name: string | null; level: string | null },
): EnteredContent | null {
  const named = followed.filter((p) => (p.display_name?.trim() || p.name))
  if (named.length === 0) return null

  // Headliner = best (lowest non-null) ranking; null sorts last; tie-break by
  // last name so the choice is deterministic across runs.
  const sorted = [...named].sort((a, b) => {
    const ra = a.ranking ?? Number.POSITIVE_INFINITY
    const rb = b.ranking ?? Number.POSITIVE_INFINITY
    if (ra !== rb) return ra - rb
    return playerLastName(a).localeCompare(playerLastName(b))
  })

  const headliner = sorted[0]
  const others = named.length - 1
  const tournamentName = tournament.name ?? 'an event'
  const name = playerLastName(headliner)

  const title = others > 0
    ? `${name} +${others} more entered ${tournamentName}`
    : `${name} entered ${tournamentName}`
  const body = others > 0
    ? 'Players you follow joined the draw.'
    : 'Just added to the entry list.'
  const icon = resolveNotificationIcon({
    reason: 'follow',
    tournamentLevel: tournament.level ?? null,
    followedPlayerAvatarUrl: headliner.avatar_url ?? null,
  })

  return { title, body, icon, url: `/player/${headliner.id}` }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/player-entered-content.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/player-entered-content.ts src/lib/__tests__/player-entered-content.test.ts
git commit -m "feat: pure builder for personalized player_entered notification content"
```

---

## Task 3: Populator passes the personalize flag + tournamentId

**Files:**
- Modify: `padelgod/src/lib/notify.ts` (add field to `NotifyEventPayload`)
- Modify: `padelgod/src/workers/fip-entry-list-populator.ts` (`flushPlayerEntered`)
- Modify: `padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts` (assert new fields)

- [ ] **Step 1: Add the payload field**

In `padelgod/src/lib/notify.ts`, inside `export interface NotifyEventPayload`, add after the `icon?: string;` field:

```ts
  /**
   * Opt-in: when true, the notify-event endpoint personalizes title/body/icon/
   * url PER RECIPIENT from the players that recipient follows (used by
   * `player_entered`). Requires entityType='player', entityIds, and
   * metadata.tournamentId. When absent, the endpoint sends the uniform
   * title/body/icon/url as before.
   */
  personalizePerFollower?: boolean;
```

- [ ] **Step 2: Update the failing populator test**

In `padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts`, find the test
`coalesces all newly-entered players in a tournament into ONE notify-event`
(around line 492). After its existing assertions on the entry post payload
(the block asserting `category: 'player_entered'` and `dedupeKey`), add:

```ts
    expect(entryPosts[0].body.personalizePerFollower).toBe(true)
    expect(entryPosts[0].body.metadata?.tournamentId).toBe(TOURNAMENT_ID)
```

Note: `entryPosts[i].body` is the parsed JSON POST body captured by
`captureNotify()`. If the existing assertions reference the payload under a
different variable (e.g. a destructured `payload`), mirror that local naming —
the two fields to assert are `personalizePerFollower === true` and
`metadata.tournamentId === TOURNAMENT_ID`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-entry-list-populator.test.ts -t "coalesces all newly-entered"`
Expected: FAIL — `personalizePerFollower` is `undefined`.

- [ ] **Step 4: Update `flushPlayerEntered`**

In `padelgod/src/workers/fip-entry-list-populator.ts`, inside `flushPlayerEntered`, update the `notifyEvent({...})` payload object. Keep all existing fields; add `metadata` and `personalizePerFollower`:

```ts
      notifyEvent(
        {
          category: 'player_entered',
          entityType: 'player',
          entityId: representativeId,
          entityIds: playerIds,
          title: 'New tournament entry',
          body: 'A player you follow just entered an event.',
          url: `/tournaments/${tournamentId}`,
          // Endpoint personalizes per recipient from the players THEY follow;
          // tournamentId lets it resolve the tournament name + level. The
          // title/body/url above stay as the generic fallback.
          personalizePerFollower: true,
          metadata: { tournamentId },
          dedupeKey: `player_entered:${tournamentId}`,
        },
        deps.notify,
      );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-entry-list-populator.test.ts`
Expected: PASS (all populator tests, including the updated coalescing test).

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/lib/notify.ts padelgod/src/workers/fip-entry-list-populator.ts padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts
git commit -m "feat: populator opts player_entered into per-follower personalization"
```

---

## Task 4: Endpoint per-recipient personalization

Add the opt-in personalization branch to `notify-event`. When the flag is set
(and preconditions met), compute per-user content; otherwise behave exactly as
today. This task has no unit test (the route uses a module-scoped Supabase
client built from env, which makes isolated unit testing impractical); the
logic it depends on is covered by Task 2's pure builder. Verification is
build + lint + a dry-run curl in Task 5.

**Files:**
- Modify: `src/app/api/push/notify-event/route.ts`

- [ ] **Step 1: Add imports**

After the existing import of `sendPushToFcmTokens` (top of file), add:

```ts
import { resolveNotificationIcon, circuitIconUrl } from '@/lib/notification-icon'
import { buildPlayerEnteredContent, type EnteredPlayer, type EnteredContent } from '@/lib/player-entered-content'
```

- [ ] **Step 2: Add the `personalizePerFollower` field to the `Body` type and parse it**

In the `type Body = { ... }` block, add:

```ts
  personalizePerFollower?: unknown
```

After the line `const icon = typeof b.icon === 'string' && b.icon ? b.icon : undefined`, add:

```ts
  const personalizePerFollower = b.personalizePerFollower === true
```

- [ ] **Step 3: Build the per-user content map (only when personalizing)**

Insert this block AFTER the `// ── 2. Batch-fetch prefs + plan ──` section completes
(i.e. after `alreadyById` is built) and BEFORE the `// ── 3. Resolve per-user ──` loop.

```ts
  // ── 2b. Per-recipient personalization (opt-in; player_entered) ──────
  // When enabled, build a per-user EnteredContent from the players THAT user
  // follows. Falls back to the uniform title/body/icon/url for any user with
  // no named followed entrant, and for anon recipients (which can't be cheaply
  // mapped to a specific followed player).
  const uniform: EnteredContent = { title, body, icon: icon ?? '', url }
  const contentByUser = new Map<string, EnteredContent>()
  let anonContent: EnteredContent = uniform
  const personalize =
    personalizePerFollower &&
    entityType === 'player' &&
    !!entityIds &&
    entityIds.length > 0 &&
    typeof (metadata as { tournamentId?: unknown }).tournamentId === 'string'

  if (personalize) {
    const tournamentId = (metadata as { tournamentId: string }).tournamentId
    const [dirRes, tournRes, followRes] = await Promise.all([
      supabase
        .from('players')
        .select('id, name, display_name, avatar_url, ranking')
        .in('id', entityIds as string[]),
      supabase.from('tournaments').select('name, level').eq('id', tournamentId).maybeSingle(),
      supabase
        .from('user_bookmarks')
        .select('user_id, target_id')
        .eq('bookmark_type', 'player')
        .in('target_id', entityIds as string[]),
    ])
    if (dirRes.error) console.error(`[notify-event] player directory read failed:`, dirRes.error.message)
    if (tournRes.error) console.error(`[notify-event] tournament read failed:`, tournRes.error.message)
    if (followRes.error) console.error(`[notify-event] follow map read failed:`, followRes.error.message)

    const dir = new Map<string, EnteredPlayer>()
    for (const p of (dirRes.data ?? []) as EnteredPlayer[]) dir.set(p.id, p)
    const tournament = (tournRes.data as { name: string | null; level: string | null } | null) ?? { name: null, level: null }

    const followedByUser = new Map<string, string[]>()
    for (const row of (followRes.data ?? []) as Array<{ user_id: string | null; target_id: string | null }>) {
      if (!row.user_id || !row.target_id) continue
      const list = followedByUser.get(row.user_id) ?? []
      list.push(row.target_id)
      followedByUser.set(row.user_id, list)
    }

    for (const [userId, playerIds] of followedByUser) {
      const followed = playerIds.map((id) => dir.get(id)).filter((p): p is EnteredPlayer => !!p)
      const built = buildPlayerEnteredContent(followed, tournament)
      if (built) contentByUser.set(userId, built)
    }

    // Anon recipients: improved-but-generic (tournament name + circuit logo).
    const tournamentName = tournament.name ?? 'an event'
    anonContent = {
      title: `New entries — ${tournamentName}`,
      body: 'Players you follow joined the draw.',
      icon: circuitIconUrl(tournament.level ?? null),
      url: `/tournaments/${tournamentId}`,
    }
  }

  const contentFor = (userId: string): EnteredContent => contentByUser.get(userId) ?? uniform
```

- [ ] **Step 4: Use per-user content for the in-app rows**

In the `// ── 3. Resolve per-user ──` loop, replace the `inAppRows.push({...})` call so the row uses per-user content:

```ts
    const c = contentFor(userId)
    inAppRows.push({
      user_id: userId,
      category,
      title: c.title,
      body: c.body,
      url: c.url,
      metadata: {
        ...metadata,
        dedupe_key: dedupeKey,
        entity_type: entityType,
        entity_id: entityId,
      },
    })
```

- [ ] **Step 5: Send per-user content on Web Push**

In the Web Push block, change the subscriptions select to include `user_id`:

```ts
      supabase.from('push_subscriptions').select('id, endpoint, keys, user_id').in('user_id', deliver),
```

Then replace the `sendPush(...)` payload to use per-user content:

```ts
      const results = await Promise.allSettled(
        subs.map((s) => {
          const c = contentFor(s.user_id as string)
          return sendPush(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { endpoint: s.endpoint as string, keys: s.keys as any },
            { title: c.title, body: c.body, url: c.url, tag, ...(c.icon ? { icon: c.icon } : {}) },
          )
        }),
      )
```

- [ ] **Step 6: Send per-user content on FCM (group tokens by content)**

In the FCM block, change the native select to include `user_id`:

```ts
      supabase.from('native_push_subscriptions').select('device_token, user_id').in('user_id', deliver),
```

Replace the token collection + single send with content-grouped sends:

```ts
    // FCM (native devices). Group tokens by resolved content so personalized
    // recipients each get their player while we still batch identical payloads.
    const nativeRows = (nativeRes.data ?? []) as Array<{ device_token: string | null; user_id: string | null }>
    const tokensByContent = new Map<string, { content: EnteredContent; tokens: string[] }>()
    for (const r of nativeRows) {
      if (!r.device_token || !r.user_id) continue
      const c = contentFor(r.user_id)
      const key = `${c.title} ${c.body} ${c.url} ${c.icon}`
      const bucket = tokensByContent.get(key) ?? { content: c, tokens: [] }
      bucket.tokens.push(r.device_token)
      tokensByContent.set(key, bucket)
    }
    fcmFired = [...tokensByContent.values()].reduce((n, b) => n + b.tokens.length, 0)
    if (tokensByContent.size > 0) {
      try {
        for (const { content: c, tokens } of tokensByContent.values()) {
          const res = await sendPushToFcmTokens(tokens, {
            title: c.title,
            body: c.body,
            url: c.url,
            tag,
            ...(c.icon ? { icon: c.icon } : {}),
          })
          fcmSent += res.success
          fcmFailed += res.failed
          fcmStale += res.invalidTokens.length
          if (res.invalidTokens.length > 0) {
            await supabase
              .from('native_push_subscriptions')
              .delete()
              .in('device_token', res.invalidTokens)
            console.log(`[NotifyEvent] Cleaned ${res.invalidTokens.length} stale FCM tokens`)
          }
        }
      } catch (err) {
        console.error('[NotifyEvent] FCM send failed:', (err as Error).message)
      }
    }
```

Note: this replaces the previous `const tokens = ...`, `fcmFired = tokens.length`, and the single `sendPushToFcmTokens` call. `fcmSent`/`fcmFailed`/`fcmStale` are already declared with `let` at function scope and start at 0, so `+=` is correct.

- [ ] **Step 7: Send per-recipient content for anon web-push**

In the `// ── 7. Anon web-push fan-out ──` block, replace the `sendPush(...)` payload to use `anonContent`:

```ts
      anonSubs.map((s) =>
        sendPush(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } },
          { title: anonContent.title, body: anonContent.body, url: anonContent.url, tag, ...(anonContent.icon ? { icon: anonContent.icon } : {}) },
        ),
      ),
```

(When not personalizing, `anonContent === uniform`, so this is byte-identical to today.)

- [ ] **Step 8: Verify build + lint**

Run: `npm run lint`
Expected: no errors in `src/app/api/push/notify-event/route.ts`.

Run: `npm run build`
Expected: build succeeds (type-checks the new route + libs).

- [ ] **Step 9: Commit**

```bash
git add src/app/api/push/notify-event/route.ts
git commit -m "feat: per-recipient personalization for player_entered push (name + avatar + player link)"
```

---

## Task 5: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full affected test suites**

Run: `npx vitest run src/lib/__tests__/player-name.test.ts src/lib/__tests__/player-entered-content.test.ts`
Expected: PASS.

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-entry-list-populator.test.ts`
Expected: PASS.

- [ ] **Step 2: Dry-run the endpoint against a real tournament**

Pick a tournament id with at least one player that some user follows (check
`user_bookmarks` where `bookmark_type='player'`). With the dev server running
(`npm run dev`, localhost:3002):

```bash
curl -s -X POST http://localhost:3002/api/push/notify-event \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "player_entered",
    "entityType": "player",
    "entityId": "<FOLLOWED_PLAYER_ID>",
    "entityIds": ["<FOLLOWED_PLAYER_ID>"],
    "title": "New tournament entry",
    "body": "A player you follow just entered an event.",
    "url": "/tournaments/<TOURNAMENT_ID>",
    "personalizePerFollower": true,
    "metadata": { "tournamentId": "<TOURNAMENT_ID>" },
    "dedupeKey": "player_entered:verify-<TOURNAMENT_ID>",
    "dryRun": true
  }' | jq
```

Expected: `{ "ok": true, "dryRun": true, "recipients": <n>, ... }` with no errors logged. (dryRun does no writes/sends — safe to repeat. The personalization branch still runs its reads.)

- [ ] **Step 3: Live single-recipient smoke test (optional, needs a test account)**

Repeat the curl from Step 2 WITHOUT `dryRun`, using a `dedupeKey` you haven't
used before, with your own account following `<FOLLOWED_PLAYER_ID>`. Confirm on
device: the push shows the player's last name + tournament in the title, the
player's avatar as the icon, and tapping opens `/player/<FOLLOWED_PLAYER_ID>`.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: verification fixups for player_entered personalization" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** per-recipient name/avatar (Task 2+4), best-ranked headliner + "+N more" (Task 2), player-page click target (Task 2 url), `resolveNotificationIcon` reuse (Task 2), opt-in flag keeping other categories untouched (Task 3+4 `personalize` guard), anon fallback (Task 4 Step 3/7), shared `playerLastName` (Task 1), dedup unchanged (populator keeps `dedupeKey`), in-app inbox shows same content (Task 4 Step 4). All covered.
- **Type consistency:** `EnteredPlayer` / `EnteredContent` defined in Task 2 and imported in Task 4; `buildPlayerEnteredContent`, `circuitIconUrl`, `resolveNotificationIcon`, `playerLastName`, `lastName` names consistent across tasks.
- **Known limitation (intentional):** the `notify-event` route itself has no unit test (module-scoped env client); pure logic lives in the tested builder. Verification is build + lint + dry-run curl.
```
