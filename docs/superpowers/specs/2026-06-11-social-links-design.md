# Social Links — "Follow us" row

**Date:** 2026-06-11
**Status:** Approved (design)

## Goal

Surface PadelNachos' official social accounts inside the app so users can find and follow them. Low-effort, high-discoverability placement on two existing surfaces.

Accounts:
- Instagram → `https://instagram.com/padelnachos`
- X (Twitter) → `https://x.com/padelnachos`
- TikTok → `https://tiktok.com/@padelnachos`

## Non-goals (YAGNI)

- No Facebook / YouTube / other networks.
- No share buttons, follower counts, or live feeds.
- No click analytics / tracking on these links.

## Component

`src/app/components/SocialLinks.tsx` — client component, inline styles (matches the codebase convention on these pages).

Renders a centered "Follow us" label above a horizontal row of three brand icons.

```
            Follow us
          IG    X   TikTok   (icon-only, no text labels)
```

Behavior:
- Each icon is an `<a href target="_blank" rel="noopener noreferrer">` with a descriptive `aria-label` (e.g. "PadelNachos on Instagram").
- Icon ~22px inside a ~44px tap target for touch.
- Default color is the page's muted grey (`currentColor` driven); hover/active raises to the brand lime/full-opacity. Honors the surrounding theme via `currentColor`.
- "Follow us" string comes from i18n (`useTranslations('social')` → `social.followUs`).

Props:
- `align?: 'center'` (default center).
- `style?: React.CSSProperties` — lets each host adjust outer margin/padding.

The three URLs live as constants inside the component (single source of truth). If they ever need editing, it's one file.

## Icons

Added to the existing shared set `src/components/icons/index.tsx`: `InstagramIcon`, `XIcon`, `TikTokIcon`.

**Deviation from the existing set, intentional:** the current icons are stroke-outline (`strokeWidth: 2.5`, `fill: none`). Brand logos are only recognizable as **filled glyphs**, so these three use `fill="currentColor"` (no stroke). They keep the 24×24 viewBox and `currentColor` so they still theme correctly and accept the same `size`/`color` props shape. This is a deliberate exception for brand recognizability, documented in a comment next to them.

## Placement

Both surfaces import and render the same `SocialLinks` component.

1. **About page** — `src/app/[locale]/(app)/about/page.tsx`, inside the contact `<div>` (around line 189–200), below the `hello@padelnachos.com` line. Inherits the centered contact block's styling.

2. **Settings → Support** — `src/app/[locale]/(app)/profile/settings/page.tsx`, at the end of the Support section after the `/about` link (around line 444), before the Sign Out block.

## i18n

Add one key to all five message files (`src/messages/{en,es,pt,it,fr}.json`) under a new `social` namespace:

- en: "Follow us"
- es: "Síguenos"
- pt: "Siga-nos"
- it: "Seguici"
- fr: "Suivez-nous"

Handles and URLs are not translated.

## Verification

- Run the dev server (`npm run dev`, localhost:3002) and confirm the row renders on `/about` and `/profile/settings` (light + dark), icons are recognizable, links open the correct profiles in a new tab, and the "Follow us" label localizes when switching locale.
- `npm run lint` clean.
