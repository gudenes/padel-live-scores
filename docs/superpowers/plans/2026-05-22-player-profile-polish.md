# Player Profile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three focused UI improvements to the player profile page: sort partners by most recent date, make the equipment widget full-width, and add a next-match/tournament strip to the player banner.

**Architecture:** All changes are confined to `src/app/[locale]/player/[id]/page.tsx` (derived data logic + JSX rendering) and the five i18n message files. No new components, no new DB queries, no schema changes.

**Tech Stack:** Next.js 16, React 19, next-intl, Supabase (data already fetched), TypeScript 5.

---

## Files to Modify

| File | What changes |
|---|---|
| `src/app/[locale]/player/[id]/page.tsx` | `DerivedData` interface, `derived` useMemo, hero JSX, OverviewTab JSX |
| `src/messages/en.json` | Add `nextMatch`, `nextTournament` keys under `player` |
| `src/messages/es.json` | Same |
| `src/messages/pt.json` | Same |
| `src/messages/it.json` | Same |
| `src/messages/fr.json` | Same |

---

## Task 1: Sort partners by most recent pairing date

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` — `derived` useMemo (~line 592)

- [ ] **Step 1: Change the partnersList sort**

In the `derived` useMemo, find this line (currently ~line 592):
```ts
const partnersList = [...partnerMap.values()].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses))
```

Replace with:
```ts
const partnersList = [...partnerMap.values()].sort((a, b) => {
  const ta = a.lastIso ? new Date(a.lastIso).getTime() : 0
  const tb = b.lastIso ? new Date(b.lastIso).getTime() : 0
  return tb - ta
})
```

- [ ] **Step 2: Verify in dev server**

Run `npm run dev` (port 3002). Open any player profile with multiple partners (e.g. a top-ranked player). Go to Partners tab. Confirm the partner listed first has the most recent `Last` date.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): sort partners tab by most recent pairing date"
```

---

## Task 2: Add nextScheduled and nextTournament to derived data

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` — `DerivedData` interface (~line 836) and `derived` useMemo (~line 540)

- [ ] **Step 1: Extend the DerivedData interface**

Find the `DerivedData` interface (~line 836) and add two fields:

```ts
interface DerivedData {
  finished: MatchRow[]
  wins: number
  losses: number
  winRate: number | null
  last10Matches: MatchRow[]
  currentPartner: PartnerInfo | null
  cpWins: number
  cpLosses: number
  firstPartneredIso: string | null
  lastPartneredIso: string | null
  partnersList: Array<{ partner: PartnerInfo; wins: number; losses: number; lastIso: string | null }>
  availableYears: number[]
  nextScheduled: MatchRow | null
  nextTournament: { id: string; name: string | null; country: string | null; level: string | null; starts_at: string | null; ends_at: string | null } | null
}
```

- [ ] **Step 2: Compute the two new fields in the derived useMemo**

At the end of the `derived` useMemo (just before the `return` statement, ~line 602), add:

```ts
// Earliest scheduled match with a known future time
const now = new Date()
const nextScheduled = matches
  .filter(m => m.status === 'scheduled' && m.scheduled_at && new Date(m.scheduled_at) > now)
  .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0] ?? null

// Earliest upcoming tournament derived from scheduled matches (only when no specific match is found)
const nextTournament: DerivedData['nextTournament'] = nextScheduled
  ? null
  : (() => {
      const seen = new Set<string>()
      return matches
        .filter(m => {
          if (m.status !== 'scheduled' || !m.tournament?.starts_at || !m.tournament.id) return false
          if (new Date(m.tournament.starts_at) <= now) return false
          if (seen.has(m.tournament.id)) return false
          seen.add(m.tournament.id)
          return true
        })
        .map(m => m.tournament!)
        .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime())[0] ?? null
    })()
```

Then update the `return` statement in `derived` to include the new fields:

```ts
return {
  finished, wins, losses, winRate, last10Matches,
  currentPartner, cpWins, cpLosses, firstPartneredIso, lastPartneredIso,
  partnersList, availableYears,
  nextScheduled, nextTournament,
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: no type errors related to `DerivedData`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): compute nextScheduled and nextTournament in derived data"
```

---

## Task 3: Add i18n keys for next match / tournament strip

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

- [ ] **Step 1: Add keys to en.json**

In `src/messages/en.json`, find the `"balance_head-light": "Head Light"` line (last key of the `player` section). Add after it:

```json
    "nextMatch": "Next match",
    "nextTournament": "Next tournament"
```

- [ ] **Step 2: Add keys to es.json**

In `src/messages/es.json`, find the equivalent `balance_head-light` line in the `player` section. Add after it:

```json
    "nextMatch": "Próximo partido",
    "nextTournament": "Próximo torneo"
```

- [ ] **Step 3: Add keys to pt.json**

In `src/messages/pt.json`, find the equivalent `balance_head-light` line in the `player` section. Add after it:

```json
    "nextMatch": "Próximo jogo",
    "nextTournament": "Próximo torneio"
```

- [ ] **Step 4: Add keys to it.json**

In `src/messages/it.json`, find the equivalent `balance_head-light` line in the `player` section. Add after it:

```json
    "nextMatch": "Prossima partita",
    "nextTournament": "Prossimo torneo"
```

- [ ] **Step 5: Add keys to fr.json**

In `src/messages/fr.json`, find the equivalent `balance_head-light` line in the `player` section. Add after it:

```json
    "nextMatch": "Prochain match",
    "nextTournament": "Prochain tournoi"
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | grep -E "error" | head -10
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(player): add nextMatch/nextTournament i18n keys (5 locales)"
```

---

## Task 4: Render the next match / tournament strip in the hero

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` — hero section in `PlayerPage` (~line 749, after the stat chips `</div>`)

- [ ] **Step 1: Add the strip import**

`DATE_WITH_WEEKDAY` and `TIME_24H` are already imported from `@/lib/format-patterns` in the file. Verify both are present in the import on line ~16:

```ts
import { DATE_SHORT, DATE_WITH_YEAR, DATE_WITH_WEEKDAY, TIME_24H } from '@/lib/format-patterns'
```

If `DATE_WITH_WEEKDAY` or `TIME_24H` are missing from the import, add them.

- [ ] **Step 2: Insert the strip JSX after the stat chips row**

Find the closing `</div>` of the stat chips block (~line 768). It looks like:

```tsx
          )}
        </div>

        {/* ── TABS */}
```

Insert the strip between the hero closing `</div>` and the TABS comment. The strip goes inside the hero `<div>` (the one with `borderBottom: 1px solid ${BORDER}`), so insert it just before that hero div's closing tag:

```tsx
        {/* Next match / tournament strip */}
        {(derived.nextScheduled || derived.nextTournament) && (() => {
          if (derived.nextScheduled) {
            const roles = resolveMatchRoles(derived.nextScheduled, id)
            const oppNames = [roles.opp1, roles.opp2]
              .filter(Boolean)
              .map(p => toShortName(p!.display_name?.trim() || p!.name))
              .join(' / ')
            const dateStr = derived.nextScheduled.scheduled_at
              ? format.dateTime(new Date(derived.nextScheduled.scheduled_at), DATE_WITH_WEEKDAY)
              : null
            const timeStr = derived.nextScheduled.scheduled_at
              ? format.dateTime(new Date(derived.nextScheduled.scheduled_at), TIME_24H)
              : null
            return (
              <div
                onClick={() => router.push(`/match/${derived.nextScheduled!.id}`)}
                style={{
                  marginTop: 8, background: 'rgba(245,166,35,0.07)',
                  border: '1px solid rgba(245,166,35,0.18)', borderRadius: 6,
                  padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 7, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 0 }}>
                  {tPlayer('nextMatch')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    vs {oppNames}{derived.nextScheduled.round ? ` · ${derived.nextScheduled.round}` : ''}
                  </div>
                  <div style={{ fontSize: 8, color: MUTED, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[derived.nextScheduled.tournament?.name ? titleCase(derived.nextScheduled.tournament.name) : null, dateStr, timeStr].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {derived.nextScheduled.tournament?.level && (
                  <div style={{ fontSize: 7, fontWeight: 800, color: '#000', background: ORANGE, padding: '2px 6px', clipPath: CHUNKY.badge, flexShrink: 0 }}>
                    {levelLabel(derived.nextScheduled.tournament.level)}
                  </div>
                )}
              </div>
            )
          }
          const tourn = derived.nextTournament!
          const dateStr = tourn.starts_at
            ? format.dateTime(new Date(tourn.starts_at), DATE_WITH_WEEKDAY)
            : null
          return (
            <div
              onClick={() => router.push(`/tournaments/${tourn.id}`)}
              style={{
                marginTop: 8, background: 'rgba(245,166,35,0.07)',
                border: '1px solid rgba(245,166,35,0.18)', borderRadius: 6,
                padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 7, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 0 }}>
                {tPlayer('nextTournament')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {titleCase(tourn.name ?? '')}
                </div>
                {dateStr && <div style={{ fontSize: 8, color: MUTED, marginTop: 1 }}>{dateStr}</div>}
              </div>
              {tourn.level && (
                <div style={{ fontSize: 7, fontWeight: 800, color: '#000', background: ORANGE, padding: '2px 6px', clipPath: CHUNKY.badge, flexShrink: 0 }}>
                  {levelLabel(tourn.level)}
                </div>
              )}
            </div>
          )
        })()}
```

- [ ] **Step 3: Verify in dev server**

Open a player profile in the browser (port 3002). For a player with upcoming matches, the strip should appear below the stat chips. For a player with no upcoming matches, no strip should appear. Check both cases.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): add next match/tournament strip to player banner"
```

---

## Task 5: Make plays-with widget full width with improved layout

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` — equipment widget in `OverviewTab` (~lines 1066–1150)

- [ ] **Step 1: Make the widget wide**

Find the equipment widget render (currently ~line 1066):
```tsx
        return (
          <Widget label={t('playsWith')}>
```

Change to:
```tsx
        return (
          <Widget wide label={t('playsWith')}>
```

- [ ] **Step 2: Increase racket image size**

Find the racket image container (~line 1128):
```tsx
              <div style={{ flexShrink: 0, width: 70, textAlign: 'center' }}>
```
Change to:
```tsx
              <div style={{ flexShrink: 0, width: 90, textAlign: 'center' }}>
```

Find the racket image element (~line 1135):
```tsx
                    style={{
                      height: 96, objectFit: 'contain',
```
Change to:
```tsx
                    style={{
                      height: 110, objectFit: 'contain',
```

- [ ] **Step 3: Switch spec rows to 2-column grid**

Find the spec block (~line 1091):
```tsx
                {hasSpecs && (
                  <div style={{ marginTop: 6 }}>
                    {racketShape && (
                      <div style={specRowStyle}>
                        <span>{t('shape')}</span>
                        <span style={specValueStyle}>{t(`shape_${racketShape}`)}</span>
                      </div>
                    )}
                    {racketWeight && (
                      <div style={specRowStyle}>
                        <span>{t('weight')}</span>
                        <span style={specValueStyle}>{racketWeight}g</span>
                      </div>
                    )}
                    {racketBalance && (
                      <div style={specRowStyle}>
                        <span>{t('balance')}</span>
                        <span style={specValueStyle}>{t(`balance_${racketBalance}`)}</span>
                      </div>
                    )}
                  </div>
                )}
```

Replace with:
```tsx
                {hasSpecs && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px', marginTop: 6 }}>
                    {racketShape && (
                      <div style={specRowStyle}>
                        <span>{t('shape')}</span>
                        <span style={specValueStyle}>{t(`shape_${racketShape}`)}</span>
                      </div>
                    )}
                    {racketWeight && (
                      <div style={specRowStyle}>
                        <span>{t('weight')}</span>
                        <span style={specValueStyle}>{racketWeight}g</span>
                      </div>
                    )}
                    {racketBalance && (
                      <div style={specRowStyle}>
                        <span>{t('balance')}</span>
                        <span style={specValueStyle}>{t(`balance_${racketBalance}`)}</span>
                      </div>
                    )}
                  </div>
                )}
```

- [ ] **Step 4: Verify in dev server**

Open a player profile with equipment data (e.g. a top-ranked player). The "Plays with" widget should span the full width. Racket image should be larger. All three spec labels and values should be fully readable without truncation.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): expand plays-with widget to full width with 2-col specs"
```

---

## Task 6: Always show FIP Ranking alongside Last 10

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` — OverviewTab, Last 10 and Ranking widgets (~lines 972–1164)

- [ ] **Step 1: Move the Ranking widget to sit after Last 10, always**

Currently the Ranking widget is rendered conditionally at the bottom with an equipment-fallback guard (~line 1152):
```tsx
      {/* FIP Ranking fallback — shown only when no equipment data */}
      {!currentEquipment?.racket && !player.equipment?.racket_brand && player.ranking != null ? (
        <Widget label="FIP Ranking">
          <div style={{ fontSize: 26, fontWeight: 800, color: GREEN, lineHeight: 1 }}>#{player.ranking}</div>
          {player.points && (
            <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
              {player.points.toLocaleString()} pts
            </div>
          )}
          <WidgetIcon>#</WidgetIcon>
        </Widget>
      ) : null}
```

**Delete** that entire block.

Then find the Last 10 widget block (~line 972). It currently renders as a half-width `Widget` (no `wide` prop). Immediately **after** the Last 10 closing `})()}`, insert the Ranking widget, now always conditional only on `player.ranking != null`:

```tsx
      {/* FIP Ranking — always visible alongside Last 10 when ranking is known */}
      {player.ranking != null && (
        <Widget label="FIP Ranking">
          <div style={{ fontSize: 26, fontWeight: 800, color: GREEN, lineHeight: 1 }}>#{player.ranking}</div>
          {player.points && (
            <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
              {player.points.toLocaleString()} pts
            </div>
          )}
          <WidgetIcon>#</WidgetIcon>
        </Widget>
      )}
```

- [ ] **Step 2: Verify layout**

Open a player profile with both equipment data and a known ranking. The grid should now show:
- Row: Last 10 (half) | FIP Ranking (half)
- Row: Plays with (full width)

Open a player profile with equipment but **no ranking** — Last 10 should sit in a single half-column (acceptable; no empty-slot fix needed).

Open a player with **no equipment** and a known ranking — Last 10 | Ranking side by side, then Profile Info wide below.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): always show FIP Ranking widget alongside Last 10"
```

---

## Self-Review

**Spec coverage:**
- [x] Partners sort by most recent date → Task 1
- [x] nextScheduled / nextTournament computed → Task 2
- [x] i18n keys for strip label → Task 3
- [x] Strip rendered in hero (match case + tournament fallback + hidden when neither) → Task 4
- [x] Plays-with full width, 2-col specs, bigger image → Task 5
- [x] FIP Ranking always alongside Last 10, equipment-fallback condition removed → Task 6

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency:**
- `DerivedData.nextScheduled: MatchRow | null` defined in Task 2 Step 1, referenced in Task 4.
- `DerivedData.nextTournament` typed inline in Task 2 Step 2 as `DerivedData['nextTournament']`, which resolves to the interface definition in Step 1.
- `tPlayer('nextMatch')` / `tPlayer('nextTournament')` — keys added in Task 3, consumed in Task 4.
- `DATE_WITH_WEEKDAY`, `TIME_24H` — both exist in `src/lib/format-patterns.ts` (verified).
- `levelLabel`, `toShortName`, `titleCase`, `CHUNKY`, `ORANGE`, `MUTED` — all defined earlier in `page.tsx`, no changes.
