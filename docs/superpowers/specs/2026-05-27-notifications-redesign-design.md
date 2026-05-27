# Notifications UX redesign — design

**Date:** 2026-05-27
**Status:** Draft for review
**Scope:** MVP + competitor polish (per brainstorm). Settings page redesign, new toggle component, bookmark nudge, category cleanup, ranking-update category, save-feedback per row.
**Out of scope:** Per-followed-player / per-bookmarked-match notification overrides (Sofascore-style granularity). "Mute notifications" duration picker UX details deferred to implementation. Sound channels editing (we deep-link to OS).

---

## 1. Goals

1. Bring the notification settings page in line with the production PressButton design system (chunky-tilted, face/skirt depth).
2. Stop showing toggles for categories that don't actually fire anything — remove dead UI.
3. Add a new "Rankings updated" category — surfaces the weekly FIP ranking refresh, leverages the worker we already run.
4. Catch users at the moment of intent (after bookmarking a match) when their notification state would prevent us from reaching them.
5. Confirm save success visually per row, so users on slow networks know their toggle stuck.
6. Provide a one-tap path from the app into the OS-level notification settings when push is blocked at the system layer.

---

## 2. Current state inventory

### Pages
- `/notifications` ([src/app/[locale]/(app)/notifications/page.tsx](../../../src/app/[locale]/(app)/notifications/page.tsx)) — in-app feed (bell icon points here). Day-grouped list, filter pills (all/matches/badges), mark-all-read, infinite scroll. Stays.
- `/profile/settings/notifications` ([src/app/[locale]/(app)/profile/settings/notifications/page.tsx](../../../src/app/[locale]/(app)/profile/settings/notifications/page.tsx)) — granular prefs page. Master push toggle + per-category PUSH/IN-APP toggles. **Gets the full redesign.**

### Categories (today)
| Category | Active? | Fired from |
|---|---|---|
| `match_live_follow` | ✅ | `/api/push/notify` (status → live transition) |
| `match_live_bookmark` | ✅ | `/api/push/notify` (status → live transition) |
| `match_finished` | ✅ | `/api/push/notify` (status → finished) |
| `match_upcoming` | ❌ | Nowhere — stub |
| `badge_earned` | ❌ | Nowhere — stub |
| `streak_milestone` | ❌ | Nowhere — stub |
| `marketing` | ❌ | Nowhere — stub (kept as future placeholder) |

### Delivery & save model
- Push + in-app run via `Promise.allSettled` in `/api/push/notify` — independently gated by `resolvePrefs` per channel.
- Settings page auto-saves on toggle via PATCH `/api/user/notification-prefs`. No save button. Error toast on failure (already shipped via PR #459).

---

## 3. Final category list

**Keep (3 active + 1 new + 1 placeholder = 5 total):**
- `match_live_follow` — A player you follow is about to play
- `match_live_bookmark` — A match you saved is starting
- `match_finished` — Results for matches you follow
- `ranking_updated` ★ **NEW** — Weekly FIP rankings refresh
- `marketing` — New features, events, occasional news *(kept as a placeholder; off by default)*

**Drop (move out of `CATEGORY_DEFAULTS` and clean up stored prefs):**
- `match_upcoming`
- `badge_earned`
- `streak_milestone`

### Category groups (UI only)
- **Matches** — `match_live_follow`, `match_live_bookmark`, `match_finished`
- **Updates** — `ranking_updated`, `marketing`

### Defaults
```ts
match_live_follow:   { push: true }
match_live_bookmark: { push: true }
match_finished:      { push: true }
ranking_updated:     { push: true }   // weekly cadence — low-frequency, fine to default on
marketing:           { push: false }  // opt-in only
```

> Note: `inApp` is no longer a per-category preference (see §4). In-app notifications fire for every category by default — only push is configurable.

---

## 4. Settings page redesign

### Layout (top → bottom)
1. **System-blocked banner** *(conditional)* — visible only when OS permission is denied. Red-tinted card with shield icon + `intent-live` chunky-tilted PressButton labeled "Open". Tapping deep-links into device notification settings via Capacitor (§7).
2. **Mute notifications** row — `intent-ghost` PressButton labeled "Mute…" when not muted; `intent-gold` PressButton showing remaining duration ("Muted · 9am") when active. Opens a duration picker sheet (§4.4).
3. **Notification sounds** row — icon-row with chevron, deep-links to OS notification channel settings (same NativeSettings plugin).
4. **Master push toggle** — labeled "Push notifications", icon-slider component (§4.2). Off here disables everything below it (rows go dim, toggles disabled).
5. **Matches** group (label + 3 cards)
6. **Updates** group (label + 2 cards)
7. **Auto-save hint footer** — "● Changes save automatically" (subtle, single line).

### 4.1 Toggle column — IN-APP removed
The PUSH/IN-APP two-column model in the current page goes away. Every category has a single icon-slider that controls push. In-app delivery becomes always-on (the `/notifications` feed populates regardless). Rationale: users never benefit from disabling in-app — the inbox is benign and discoverable only when opened. Settings stays focused on the noisy channel.

**Type change:** `ChannelPrefs` simplifies from `{ push: boolean; inApp: boolean }` to `{ push: boolean }`. `resolvePrefs` returns only `push`. Call sites that destructure `inApp` (the `/api/push/notify` endpoint) get updated to assume in-app delivery is always on.

**Migration:** existing `notification_prefs.<category>.inApp` keys in `profiles.notification_prefs` JSONB become orphans that the new resolver ignores. We do NOT run a SQL migration to clear them — cheap to leave in place and protects against the (unlikely) need to roll back. Optional cleanup migration can run later.

### 4.1.1 Filter pill cleanup on `/notifications`
With `badge_earned` + `streak_milestone` gone, the "Badges" filter pill in the `/notifications` feed page becomes dead. Drop it. `categoryFilter()` becomes `'all' | 'matches' | 'updates'` returning `null | [3 match categories] | ['ranking_updated', 'marketing']` — keeps parity with the Settings page groups.

### 4.2 Icon-slider component (locked from brainstorm)

A custom toggle component, NOT the existing `<Toggle>` button in the current page.

**Anatomy:**
- 52×28px track, chunky-tilted clip-path `polygon(0% 8%, 100% 0%, 100% 92%, 0% 100%)`
- 22×22px dark thumb (`#0a0a0a`) with same clip-path, slides 24px between left/right
- Icon centered in thumb: muted X (`rgba(255,255,255,0.45)`) when off, primary green check (`#7ED321`) when on — crossfade 180ms ease-out

**States:**
- **Off** — track `rgba(126,211,33,0.06)` with `1.5px` inset green border `rgba(126,211,33,0.35)`. Thumb at `left: 3px`. X visible.
- **On** — track `#7ED321` (primary face color), no border, inset highlight + shadow. Thumb at `left: 27px`. Check visible.

**Transitions:**
- `background` + `box-shadow` 220ms ease-out
- Thumb `left` 220ms cubic-bezier(0.4, 0, 0.2, 1) — slight overshoot feel
- Icon opacity 180ms ease-out (slightly faster so icon settles before slide)

**Disabled state** (when master toggle off OR row is saving): opacity 0.4, pointer-events: none.

**Accessibility:** `role="switch"`, `aria-checked`, keyboard `Space`/`Enter` toggles.

### 4.3 Per-row save feedback (Variant B — transient saving → saved)

Each row reserves a 24×24px slot to the right of the toggle for transient save state. Default empty (occupies space so layout doesn't shift mid-save).

**Sequence on tap:**
1. Tap → optimistic UI flips the toggle immediately (220ms slide)
2. Spinner appears in the slot (14×14px green-ringed spinner, spin 800ms linear infinite)
3. PATCH `/api/user/notification-prefs` fires
4. On success: spinner crossfades to a check (180ms), check holds for ~1.5s then fades out (over 1500ms, easing out). Slot returns to empty.
5. On failure: spinner clears; toggle reverts to previous state (existing optimistic-rollback behavior); error toast shows (existing PR #459 plumbing).

**Implementation note:** the existing `patch()` callback in `notifications/page.tsx` (lines 74-91) handles optimistic rollback + error toast. We add per-row state for `saving | saved | idle` and animate accordingly.

### 4.4 Mute action

Opens a bottom sheet with duration options:
- 1 hour
- 4 hours
- Until tomorrow 8 AM
- Until I turn it back on

Stores in `profiles.notification_prefs.mute_until` (ISO timestamp or `null`/`"forever"`).

`/api/push/notify` checks this before fan-out — if `mute_until > now()`, the push branch returns early but the in-app `user_notifications` insert still runs. Mute snoozes the noisy channel, doesn't lose history.

Master-toggle interaction: when muted, the master toggle stays visually "on" (since the per-category prefs are intact) but the mute chip badge shows beside it ("Muted · 9am"). Toggling master off cancels the mute by setting `mute_until = null`.

---

## 5. Bookmark nudge

A bottom sheet that appears the first time a user bookmarks a match (or follows a player) while their notification state would prevent us from reaching them.

### 5.1 Trigger

Wraps the existing bookmark/follow click handlers. Two trigger surfaces:
- `MatchCard` / match detail page bookmark button → may show nudge after bookmark succeeds
- Player profile follow button → may show nudge after follow succeeds

**The bookmark/follow itself always succeeds first.** The nudge is informational.

### 5.2 Conditions

Show the nudge if EITHER:
- A) **OS permission is denied** (i.e., `Notification.permission === 'denied'` on web, `FirebaseMessaging.checkPermissions().receive !== 'granted'` on native). Priority — overrides B.
- B) **In-app push pref is OFF** for the relevant category:
  - Bookmarking a match → check `match_live_bookmark.push`
  - Following a player → check `match_live_follow.push`

Skip the nudge if neither condition holds (user is already set up).

### 5.3 Dismissal tracking

After "Not now" or backdrop dismissal, suppress for **7 days per category**. Stored client-side in `localStorage` to avoid a server round-trip on every bookmark.

```ts
const KEY = `pn:nudge-dismissed:${category}` // e.g. pn:nudge-dismissed:match_live_bookmark
localStorage.setItem(KEY, String(Date.now()))
// Check: skip if Date.now() - parseInt(localStorage.getItem(KEY) || '0') < 7 * 86400_000
```

Tapping "Turn on" (success path) also marks dismissed so we don't re-prompt after the user already fixed it.

### 5.4 UI — two states

Both states use the same bottom-sheet shell (drag handle, large icon, title, body, two-button footer). Only icon/copy/CTA color change.

**State 1 — In-app pref off (OS perm OK):**
- Icon: bell, green tint
- Title: "Get notified when this match starts" *(or "...when this player plays" for follow)*
- Body: "Push notifications for bookmarked matches are turned off. Enable to get a banner when this one goes live."
- Buttons: `intent-ghost` "Not now" / `intent-primary` "Turn on"
- "Turn on" calls existing PATCH `/api/user/notification-prefs` to set `match_live_bookmark.push = true`, then dismisses.

**State 2 — OS permission denied:**
- Icon: shield-alert, red tint
- Title: "Notifications are off on this device"
- Body: "Match alerts won't reach you until you enable notifications for PadelNachos in device settings."
- Buttons: `intent-ghost` "Not now" / `intent-live` "Open settings"
- "Open settings" calls Capacitor `NativeSettings` plugin (§7).

### 5.5 Implementation

Three pieces working together via React context:

1. **`<NotificationNudgeProvider>`** (in `src/components/NotificationNudgeProvider.tsx`) — context owner. Mounted once in the `(app)/layout.tsx` so all logged-in routes share one instance. Holds `activeNudge: NudgeState | null` and the show/dismiss setters.
2. **`<NotificationNudgeSheet>`** — rendered by the provider when `activeNudge` is non-null. Reads from context, owns the sheet UI, slide-up animation, backdrop, button handlers. Single instance — never more than one sheet at a time.
3. **`useNotificationNudge()`** — call-site hook. Returns `triggerNudge({ category })`. Internally checks the dismissal-tracking key + current OS perm + stored prefs, decides which state (if any) to show, calls the provider's setter.

```ts
// Call site (after bookmark/follow success):
const { triggerNudge } = useNotificationNudge()

await bookmarkMatch(matchId)
triggerNudge({ category: 'match_live_bookmark' })
// returns immediately — sheet appears async if conditions warrant
```

The hook never blocks the caller. `triggerNudge` is fire-and-forget. The check + show flow runs in a microtask.

---

## 6. Gear icon on `/notifications`

Add a gear icon to the right of the sub-header (currently has back + "Mark all read"). Tapping navigates to `/profile/settings/notifications`.

Single-line change in [notifications/page.tsx](../../../src/app/[locale]/(app)/notifications/page.tsx) sub-header area.

---

## 7. System-settings deep-link (Capacitor)

We need to open the OS notification-settings page for the app — both in the system-blocked banner on Settings, and in the bookmark nudge's State 2.

**Plugin:** `@capacitor-community/native-settings` (NOT currently installed).

```ts
import { NativeSettings, AndroidSettings, IOSSettings } from '@capacitor-community/native-settings'

await NativeSettings.open({
  optionAndroid: AndroidSettings.AppNotification,
  optionIOS: IOSSettings.App,
})
```

**Web fallback:** since web users can't deep-link to OS settings, render the button on web with copy "Open browser permissions" and link to `chrome://settings/content/notifications` (Chrome) or show an instructional toast (other browsers).

### 7.1 AAB rebuild required

Installing the native plugin requires a `cap sync android` + new AAB upload + Play Store rollout. **This is the only piece of this redesign that needs a new native build.** Everything else (Settings UI, save feedback, bookmark nudge presentation logic, gear icon, category schema changes) ships via Vercel.

**Phasing:** ship the web-only pieces first behind a flag for the deep-link buttons. When the new AAB rolls out, the buttons activate; on older AABs they fall back to a toast: "Open Settings → Apps → PadelNachos → Notifications to enable."

---

## 8. Rankings updated category — implementation

### Trigger

Padelgod's `player-rankings` worker writes weekly snapshots to `player_ranking_snapshots`. Add a post-write fan-out step that:

1. Identifies users whose followed players had a rank change in this week's snapshot.
2. For each such user with `ranking_updated.push = true`, POSTs to `/api/push/notify-ranking` (new endpoint).
3. Endpoint composes a message like: *"FIP rankings updated · Tapia +2 ↑ · Coello -1 ↓"* — top 3 mover summary for followed players, fall back to generic "FIP rankings updated · See where your players stand" for users with many followed players or no movers.
4. `/notifications` route also gets `user_notifications` row of category `ranking_updated`, linking to `/rankings`.

### Frequency cap

Padelgod's rankings worker writes both `official` and `race` snapshots. **Cap to one notification per user per ISO week**, regardless of which list updated. Tracked by checking for any existing `user_notifications` row with `category='ranking_updated'` and `created_at >= week_start`.

### Defer for phase 2

The fan-out worker + endpoint can ship after the Settings UI. Phase 1 ships the category pref + UI only; phase 2 wires the actual sender.

---

## 9. Files affected

### New files
- `src/components/IconSlider.tsx` — the toggle component
- `src/components/NotificationNudgeProvider.tsx` — context + mounted sheet (rendered once in the app layout)
- `src/components/NotificationNudgeSheet.tsx` — bottom-sheet UI (rendered by provider)
- `src/components/MuteDurationSheet.tsx` — mute duration picker
- `src/hooks/useNotificationNudge.ts` — trigger + dismissal-tracking logic
- `src/lib/native-settings.ts` — wraps the Capacitor NativeSettings plugin with web fallback
- `src/app/api/push/notify-ranking/route.ts` — phase 3 fan-out endpoint (deferred)
- `padelgod/src/workers/ranking-notify-fanout.ts` — phase 3 worker (deferred)

### Modified
- `src/app/[locale]/(app)/profile/settings/notifications/page.tsx` — full rewrite of layout
- `src/app/[locale]/(app)/notifications/page.tsx` — add gear icon in sub-header
- `src/lib/notification-categories.ts` — drop 3 categories, add `ranking_updated`, simplify `ChannelPrefs` shape
- `src/components/MatchCard.tsx` (and any other bookmark surfaces) — call `triggerNudge` after bookmark success
- `src/app/[locale]/(app)/player/[id]/page.tsx` — call `triggerNudge` after follow success
- `package.json` — add `@capacitor-community/native-settings`
- `android/` — `cap sync` output (auto-generated)
- `src/messages/{en,es,pt,it,fr}.json` — new keys (~12 strings)

### Data
- No schema migration required. `notification_prefs.match_upcoming|badge_earned|streak_milestone` rows in profiles become orphan keys that resolvePrefs ignores. Safe to leave in place; optional cleanup migration can run later.

---

## 10. i18n keys to add (under `notifications.settings.*`)

- `groupMatches`, `groupUpdates` *(already exist for "Other"; rename one)*
- `category.ranking_updated.label`, `category.ranking_updated.sub`
- `mute.label`, `mute.sub`, `mute.cta`, `mute.activeChip` *("Muted until {time}")*
- `mute.durations.1h|4h|tomorrow|forever`
- `sounds.label`, `sounds.sub`
- `blocked.title`, `blocked.body`, `blocked.cta`
- `saveHint` ("Changes save automatically")
- `nudge.match.title`, `nudge.match.body`, `nudge.match.cta`
- `nudge.player.title`, `nudge.player.body`
- `nudge.osBlocked.title`, `nudge.osBlocked.body`, `nudge.osBlocked.cta`
- `nudge.dismiss`

Delete keys: `notifications.settings.category.match_upcoming.*`, `badge_earned.*`, `streak_milestone.*`, `columnPush`, `columnInApp` (no longer needed).

---

## 11. Implementation phases

**Phase 1 — Web-only redesign (ships via Vercel, no AAB needed):**
- IconSlider component + replace toggles on Settings page
- Drop 3 categories from `notification-categories.ts` + UI
- Add `ranking_updated` category to prefs UI (pref persistence works; fan-out comes later)
- Per-row save-feedback (saving → saved)
- Gear icon on `/notifications`
- Bookmark nudge component + trigger from bookmark/follow surfaces
- i18n keys
- Blocked banner + nudge State 2 use the **toast-fallback** for "Open settings" (no native plugin yet)

**Phase 2 — Native AAB release:**
- Add `@capacitor-community/native-settings`, `cap sync android`
- Wire blocked-banner + nudge State 2 buttons to the real `NativeSettings.open()` call
- Bump versionCode + build + Play Store rollout

**Phase 3 — Rankings notification fan-out:**
- New padelgod worker `ranking-notify-fanout` (post-snapshot step)
- New endpoint `/api/push/notify-ranking`
- Frequency cap logic
- E2E test on a small cohort before opening to all users

---

## 12. Testing

### Unit
- IconSlider: aria-checked toggles, keyboard activation, disabled state
- useNotificationNudge: dismissal-tracking math (7-day rollover), state-priority (OS-blocked beats pref-off), skip-when-fine
- notification-categories: resolvePrefs with stored keys for removed categories returns defaults for active categories, ignores orphans

### Integration
- Tap toggle → PATCH fires → success → saving→saved animation in DOM
- Tap toggle → PATCH 5xx → toggle reverts → error toast shows
- Bookmark match with push off → nudge appears with State 1
- Bookmark match with OS perm denied → nudge appears with State 2
- Dismiss nudge → bookmark another match within 7 days → no nudge
- After 7 days → nudge appears again

### Manual
- Real Android device with OS notifications denied — confirm State 2 toast fallback wording (phase 1) → confirm NativeSettings opens correct screen (phase 2)
- Real Android device with OS perm OK + bookmark pref off — confirm State 1 nudge + "Turn on" tap actually flips the pref
- Slow network simulation (Chrome devtools throttle to Slow 3G) — confirm saving spinner visible long enough to be meaningful

---

## 13. Open questions for review

1. **Mute durations** — proposed list is {1h, 4h, until tomorrow 8am, until I turn it back on}. Want to add custom or shorter (15min)?
2. **Marketing category default** — currently `push: false`. Confirm staying opt-in.
3. **`ranking_updated` default** — proposed `push: true` (weekly cadence is low-frequency). Could go `false` to be conservative.
4. **`inApp` field deprecation** — confirm OK to ignore stored values rather than running a migration to clear them. The orphans cost ~50 bytes per user; cleanup is optional.
5. **Phase 3 timing** — does the rankings notification fan-out ship in this same body of work, or as a follow-up?
