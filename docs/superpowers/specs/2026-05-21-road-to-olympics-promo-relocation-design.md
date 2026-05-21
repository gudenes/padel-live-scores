# Road to Olympics — relocate promo card from home to Originals tab

**Date:** 2026-05-21
**Status:** Approved, ready for implementation
**Scope:** Frontend placement change. No data model, API, or schema changes.

## Why

The Road to Olympics promo card currently lives on the home page, sandwiched between "Latest News" and "Tournament Spotlight Hero". The home feed is already dense (live tournaments carousel, live now, coming up, news, spotlight, rankings, results, padelgenius teaser, footer) and the card competes with high-engagement modules for attention. The Originals tab on `/feed` is editorial real estate — a natural home for a long-form CTA pointing fans at the IOC countdown hub.

## Today

- Home page mounts `<RoadToOlympicsHomeCard />` at `src/app/[locale]/(app)/home/page.tsx:547`, right after the "Latest News" block.
- The card itself is `src/components/road-to-olympics/HomeCard.tsx` — a self-contained green CTA with built-in `if (days > 365) return null` cutoff once the IOC milestone passes.
- The `/feed` Originals tab at `src/app/[locale]/(app)/feed/FeedClient.tsx:940` renders a column of `NewsCardOriginal` items (first as `variant='hero'`, rest `'standard'`) with an empty-state fallback when the `originals` prop is empty.

## Change

### 1. Remove from home page

In `src/app/[locale]/(app)/home/page.tsx`:
- Remove the `RoadToOlympicsHomeCard` import.
- Remove the JSX block at lines 546–547 (`{/* ── ROAD TO OLYMPICS HERO CARD ── */}` + `<RoadToOlympicsHomeCard />`).

The "Latest News" section flows directly into "Tournament Spotlight Hero" with no gap regression — both blocks already provide their own vertical margins.

### 2. Rename component

- Move `src/components/road-to-olympics/HomeCard.tsx` → `src/components/road-to-olympics/PromoCard.tsx`.
- Rename the default export `RoadToOlympicsHomeCard` → `RoadToOlympicsPromoCard`.
- Update the leading file-comment (currently references `home/page.tsx`) to describe the new mounting site.

Translation keys (`roadToOlympics.homeCard.*`) stay as-is — renaming them touches all 5 locale files and is out of scope for this change.

### 3. Pin at top of Originals tab

In `src/app/[locale]/(app)/feed/FeedClient.tsx`, inside the `activeTab === 'originals'` branch (currently lines 940–958):

```tsx
{activeTab === 'originals' ? (
  <>
    <div style={{ padding: '0 16px' }}>
      <RoadToOlympicsPromoCard />
    </div>
    {originals.length === 0 ? (
      <div style={{ textAlign: 'center', padding: '60px 20px', fontSize: 14, color: MUTED, fontWeight: 600 }}>
        {tFeed('empty.originals')}
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px' }}>
        {originals.map((post, i) => (
          <NewsCardOriginal key={post.id} post={post} variant={i === 0 ? 'hero' : 'standard'} />
        ))}
      </div>
    )}
  </>
) : /* unchanged */}
```

The PromoCard wrapper uses `padding: '0 16px'` (horizontal only) to match the article list's horizontal inset. The card's own `margin: '14px 0'` supplies vertical spacing.

## Behavior matrix

| `days > 365` | `originals.length` | Result |
|---|---|---|
| no | 0 | Card visible; "no originals yet" empty state below |
| no | >0 | Card visible; article list below |
| yes (post-IOC) | 0 | No card; empty state alone (pre-existing behavior) |
| yes (post-IOC) | >0 | No card; article list alone (pre-existing behavior) |

Once the IOC milestone passes, the card disappears organically via its existing cutoff. No follow-up cleanup required.

## Out of scope

- No changes to the card's visual design, copy, or click telemetry (the existing `<Link href="/road-to-olympics">` still fires Next.js navigation events from its new location).
- No empty-state copy tweak — when the card is visible but there are zero Originals, "no originals yet" still renders below it.
- No translation-key rename.
- Home page section reordering for any other modules.

## Files touched

1. `src/app/[locale]/(app)/home/page.tsx` — remove import + JSX block.
2. `src/components/road-to-olympics/HomeCard.tsx` → `PromoCard.tsx` — file rename + identifier rename + comment update.
3. `src/app/[locale]/(app)/feed/FeedClient.tsx` — add import + render block at top of Originals branch.

Three files, no migrations, no env vars, no new dependencies.
