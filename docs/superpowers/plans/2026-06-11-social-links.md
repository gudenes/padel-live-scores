# Social Links — "Follow us" Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable "Follow us" social-icon row (Instagram, X, TikTok) to the About page and the Settings → Support section.

**Architecture:** One shared client component (`SocialLinks`) renders a centered "Follow us" label + three brand-icon links. Three new filled-glyph icons are added to the existing shared icon set. The component is dropped into two existing surfaces. One i18n string (`social.followUs`) is added across all 5 locales.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, next-intl, inline styles (matching the existing pages).

**Testing note:** This repo has no React-component test harness (vitest is used only for `src/lib` pure-function units, e.g. `score-inference.test.ts`). Adding jsdom + testing-library for a presentational 3-link component is out of scope. Verification is therefore via `npm run lint`, `npm run build` (type-check), and manual browser verification per the spec — these are the project's real gates for UI work.

---

## File Structure

- **Create:** `src/app/components/SocialLinks.tsx` — the shared "Follow us" component. Single responsibility: render the label + the three icon links. Holds the three URLs as local constants (single source of truth).
- **Modify:** `src/components/icons/index.tsx` — add `InstagramIcon`, `XIcon`, `TikTokIcon` (filled glyphs; deliberate exception to the stroke-outline convention, documented in a comment).
- **Modify:** `src/app/[locale]/(app)/about/page.tsx` — render `<SocialLinks/>` inside the contact block.
- **Modify:** `src/app/[locale]/(app)/profile/settings/page.tsx` — render `<SocialLinks/>` at the end of the Support section.
- **Modify:** `src/messages/{en,es,pt,it,fr}.json` — add the `social` namespace with `followUs`.

---

### Task 1: Add brand icons to the shared icon set

**Files:**
- Modify: `src/components/icons/index.tsx` (append new exports near the end of the file, before the final closing of the module)

- [ ] **Step 1: Add the three filled-glyph brand icons**

Append these to `src/components/icons/index.tsx`. Note: unlike the rest of the set, these use `fill` (not stroke) because brand logos are only recognizable as solid glyphs — see the comment.

```tsx
// --- Brand glyphs -----------------------------------------------------------
// DELIBERATE EXCEPTION to the stroke-outline convention above: social brand
// logos are only recognizable as FILLED glyphs, so these use fill={color}
// (no stroke). They keep the 24×24 viewBox and the {size,color} prop shape so
// they drop into the same call sites and theme via currentColor.

export function InstagramIcon({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="5" stroke={color} strokeWidth="2" />
      <circle cx="12" cy="12" r="4.2" stroke={color} strokeWidth="2" />
      <circle cx="17.4" cy="6.6" r="1.3" fill={color} />
    </svg>
  )
}

export function XIcon({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  )
}

export function TikTokIcon({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.2v12.93a2.59 2.59 0 1 1-2.59-2.59c.27 0 .53.04.78.12v-3.3a5.88 5.88 0 0 0-.78-.05 5.89 5.89 0 1 0 5.89 5.89V9.4a7.46 7.46 0 0 0 4.32 1.38V7.58a4.28 4.28 0 0 1-3.36-1.76Z" />
    </svg>
  )
}
```

- [ ] **Step 2: Type-check the icons compile**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/social-links && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "icons/index" || echo "no icon type errors"`
Expected: `no icon type errors`

- [ ] **Step 3: Commit**

```bash
git add src/components/icons/index.tsx
git commit -m "feat(icons): add Instagram, X, TikTok brand glyphs"
```

---

### Task 2: Create the SocialLinks component

**Files:**
- Create: `src/app/components/SocialLinks.tsx`

- [ ] **Step 1: Write the component**

Create `src/app/components/SocialLinks.tsx`:

```tsx
'use client'
// src/app/components/SocialLinks.tsx
// Shared "Follow us" row — three brand-icon links to PadelNachos' socials.
// Used by the About page and Settings → Support. URLs live here as the
// single source of truth.

import { useTranslations } from 'next-intl'
import { InstagramIcon, XIcon, TikTokIcon } from '@/components/icons'

const LINKS = [
  { key: 'instagram', label: 'Instagram', href: 'https://instagram.com/padelnachos', Icon: InstagramIcon },
  { key: 'x', label: 'X', href: 'https://x.com/padelnachos', Icon: XIcon },
  { key: 'tiktok', label: 'TikTok', href: 'https://tiktok.com/@padelnachos', Icon: TikTokIcon },
] as const

const MUTED = '#6B7280'
const HOVER = '#7ED321'

export default function SocialLinks({ style }: { style?: React.CSSProperties }) {
  const t = useTranslations('social')
  return (
    <div style={{ textAlign: 'center', ...style }}>
      <div style={{
        color: MUTED, fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
      }}>
        {t('followUs')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        {LINKS.map(({ key, label, href, Icon }) => (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`PadelNachos on ${label}`}
            style={{
              width: 44, height: 44, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: MUTED, textDecoration: 'none',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = HOVER }}
            onMouseLeave={(e) => { e.currentTarget.style.color = MUTED }}
          >
            <Icon size={22} color="currentColor" />
          </a>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check the component compiles**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/social-links && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "SocialLinks" || echo "no SocialLinks type errors"`
Expected: `no SocialLinks type errors` (note: `social.followUs` not existing yet won't be a type error until next-intl typegen; the i18n key is added in Task 5)

- [ ] **Step 3: Commit**

```bash
git add src/app/components/SocialLinks.tsx
git commit -m "feat(social): add SocialLinks Follow-us component"
```

---

### Task 3: Add the i18n string to all 5 locales

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

- [ ] **Step 1: Add the `social` namespace to each locale file**

Add a top-level `"social"` key to each file. Place it alphabetically or at the end of the top-level object (valid JSON either way). Translations:

- `src/messages/en.json`: `"social": { "followUs": "Follow us" }`
- `src/messages/es.json`: `"social": { "followUs": "Síguenos" }`
- `src/messages/pt.json`: `"social": { "followUs": "Siga-nos" }`
- `src/messages/it.json`: `"social": { "followUs": "Seguici" }`
- `src/messages/fr.json`: `"social": { "followUs": "Suivez-nous" }`

- [ ] **Step 2: Verify all 5 files are valid JSON and have the key**

Run:
```bash
cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/social-links && python3 -c "
import json
for loc in ['en','es','pt','it','fr']:
    d=json.load(open(f'src/messages/{loc}.json'))
    assert d['social']['followUs'], loc
    print(loc, '->', d['social']['followUs'])
"
```
Expected: prints the 5 translations, no assertion error.

- [ ] **Step 3: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(social): add social.followUs in all 5 locales"
```

---

### Task 4: Render SocialLinks on the About page

**Files:**
- Modify: `src/app/[locale]/(app)/about/page.tsx` (contact block, ~lines 189–200)

- [ ] **Step 1: Add the import**

At the top of `src/app/[locale]/(app)/about/page.tsx`, after the existing `import { Link } from '@/i18n/navigation'` line, add:

```tsx
import SocialLinks from '@/app/components/SocialLinks'
```

- [ ] **Step 2: Render the component inside the contact block**

In the Contact `<div>`, after the closing `</p>` that holds the `hello@padelnachos.com` link (currently around line 199), add `<SocialLinks/>` with top spacing. The block becomes:

```tsx
      {/* Contact */}
      <div style={{
        textAlign: 'center', padding: '20px',
        borderTop: `0.5px solid ${BORDER}`,
      }}>
        <p style={{ color: MUTED, fontSize: 12, margin: 0 }}>
          {t('contact')}{' '}
          <a href="mailto:hello@padelnachos.com" style={{ color: GREEN, textDecoration: 'none', fontWeight: 600 }}>
            hello@padelnachos.com
          </a>
        </p>
        <SocialLinks style={{ marginTop: 24 }} />
      </div>
```

- [ ] **Step 3: Type-check**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/social-links && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "about/page" || echo "no about page type errors"`
Expected: `no about page type errors`

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(app)/about/page.tsx"
git commit -m "feat(about): show SocialLinks in contact footer"
```

---

### Task 5: Render SocialLinks in Settings → Support

**Files:**
- Modify: `src/app/[locale]/(app)/profile/settings/page.tsx` (Support section, ~lines 437–444)

- [ ] **Step 1: Add the import**

In `src/app/[locale]/(app)/profile/settings/page.tsx`, after the existing component imports (e.g. after `import { DeleteAccountModal } from './DeleteAccountModal'`), add:

```tsx
import SocialLinks from '@/app/components/SocialLinks'
```

- [ ] **Step 2: Render the component after the About link**

In the SUPPORT section, after the `/about` `<Link>` block (currently ending around line 444) and before the SIGN OUT block, add:

```tsx
      <Link href="/about" style={{ textDecoration: 'none' }}>
        <Row label={t('support.about')} control={<Chevron />} />
      </Link>

      <SocialLinks style={{ padding: '24px 16px 4px' }} />
```

- [ ] **Step 3: Type-check**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/social-links && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "settings/page" || echo "no settings page type errors"`
Expected: `no settings page type errors`

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(app)/profile/settings/page.tsx"
git commit -m "feat(settings): show SocialLinks in Support section"
```

---

### Task 6: Full verification (lint, build, browser)

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/social-links && npm run lint`
Expected: no errors (warnings pre-existing in the repo are acceptable; no new errors referencing the changed files).

- [ ] **Step 2: Type-check the whole project**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/social-links && npx tsc --noEmit -p tsconfig.json`
Expected: clean (no errors in changed files; if next-intl typegen complains about the new `social` key, run the project's typegen/build once — Step 3 covers this).

- [ ] **Step 3: Production build (catches next-intl message typing + RSC/client boundary issues)**

Run: `cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/social-links && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Browser verification**

Start the dev server (`npm run dev`, localhost:3002) and verify with the preview tools:
- Navigate to `/about` — the "Follow us" row appears below the contact email with three recognizable icons.
- Navigate to `/profile/settings` — the row appears at the end of the Support section, above Sign Out.
- Confirm each icon links to the correct profile (`instagram.com/padelnachos`, `x.com/padelnachos`, `tiktok.com/@padelnachos`) and opens in a new tab (`target="_blank"`).
- Switch locale (e.g. `/es/about`) and confirm the label localizes ("Síguenos").
- Check it renders correctly on a mobile viewport (preview_resize) — icons centered, tappable.

- [ ] **Step 5: No commit needed** — verification only. If any step fails, fix in the relevant task's file and re-run.

---

## Self-Review

- **Spec coverage:** SocialLinks component (Task 2) ✓; filled brand glyphs in shared icon set (Task 1) ✓; About placement (Task 4) ✓; Settings Support placement (Task 5) ✓; `social.followUs` in 5 locales (Task 3) ✓; non-goals (no analytics/extra networks) — nothing added, ✓; verification incl. light/dark + locale switch + new-tab (Task 6) ✓.
- **Placeholders:** none — every step has concrete code/commands.
- **Type consistency:** `IconProps` reused from the existing icon module (has `size`, `color`, `strokeWidth` — the brand glyphs only consume `size`/`color`, which is valid since props are optional). `SocialLinks` default-exported and imported as `SocialLinks` in both pages. `social.followUs` key matches `useTranslations('social')` + `t('followUs')`.
- **Note on dark theme:** both host pages are dark-themed (About `BG #0D0D0D`, Settings `BG_BASE #1A1A1A`); `MUTED #6B7280` + lime hover match those pages' existing palette, so the row reads correctly. There is no separate light theme on these user-facing pages (light/dark theming is the ops shell only).
