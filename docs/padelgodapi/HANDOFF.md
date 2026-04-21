# PadelGod API Docs — Handoff

_Last updated: 2026-04-22_

This doc is for whoever picks up `/padelgodapi` tomorrow (probably you).
It's a one-page inventory of what's in the PR, what still needs doing, and
how to iterate without breaking things.

---

## What's shipped in this PR

### Route: `/padelgodapi`

A self-contained section of the Next.js app, independent of the locale-aware
app shell (no bottom nav, no main-app chrome).

| Path | File | Status |
|---|---|---|
| `/padelgodapi` | `src/app/padelgodapi/page.tsx` | ✅ landing |
| `/padelgodapi/introduction` | `src/app/padelgodapi/introduction/page.tsx` | ✅ content |
| `/padelgodapi/coverage` | `src/app/padelgodapi/coverage/page.tsx` | ✅ content + feature matrix |
| `/padelgodapi/architecture` | `src/app/padelgodapi/architecture/page.tsx` | ✅ content + inline SVG-less flow diagram |
| `/padelgodapi/workers` | `src/app/padelgodapi/workers/page.tsx` | ✅ table of all 13 workers |
| `/padelgodapi/data-model` | `src/app/padelgodapi/data-model/page.tsx` | ✅ top 4 public tables |
| `/padelgodapi/roadmap` | `src/app/padelgodapi/roadmap/page.tsx` | ✅ milestones + public API plans |
| `/padelgodapi/getting-started` | — | 🔒 placeholder in sidebar ("coming soon") |
| `/padelgodapi/authentication` | — | 🔒 same |
| `/padelgodapi/endpoints` | — | 🔒 same |
| `/padelgodapi/rate-limits` | — | 🔒 same |
| `/padelgodapi/error-codes` | — | 🔒 same |

### Layout + components

All in `src/app/padelgodapi/_components/`:

- `DocsSidebar.tsx` — client component, usePathname for active-link highlight
- `PageHeader.tsx` — consistent `<h1>` + eyebrow + lead paragraph
- `Prose.tsx` — typographic styles for long-form content (headings, tables, code, lists, quotes). Wrap page content with `<Prose>{...}</Prose>`
- `Callout.tsx` — info / warning / note / success boxes
- `PrevNextLinks.tsx` — bottom-of-page pager, driven by nav order

Nav config lives at `src/app/padelgodapi/_lib/navigation.ts` — **single source of truth**. Reorder / rename there; sidebar + pager update automatically.

### Styling approach

- Uses the existing **Forge Dark v2** design tokens (CSS variables in `globals.css`): `--bg-base`, `--text-primary`, `--color-accent`, etc.
- Tailwind utilities + arbitrary values referencing the CSS variables
- No new dependencies added
- No dark/light toggle (site is dark-only; this inherits)

---

## How to add a new page

1. Create `src/app/padelgodapi/{slug}/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { PageHeader } from '../_components/PageHeader'
import { Prose } from '../_components/Prose'
import { PrevNextLinks } from '../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'My New Page' }

export default function MyNewPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Section name"
        title="My new page"
        description="One-sentence summary."
      />
      <Prose>
        <h2>Section heading</h2>
        <p>Body text. Code blocks, tables, lists, callouts all work here.</p>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/my-new-page" />
    </article>
  )
}
```

2. Add the entry to `DOCS_NAVIGATION` in `_lib/navigation.ts`:

```ts
{
  title: 'Overview',
  items: [
    ...existing,
    { label: 'My new page', href: '/padelgodapi/my-new-page' },
  ],
}
```

Sidebar + prev/next pager pick it up automatically.

---

## What to prioritize next (order of value)

### 1. Un-stub the "coming soon" pages — if you want external-API energy

The biggest visible gap is the **Developer API** section (getting-started, authentication, endpoints, rate-limits, error-codes). Today they're placeholder labels with "soon" chips.

To unblock: even a thin placeholder page like "Public API access is in closed beta — email hello@padelnachos.com for early access" is better than no page at all, because:
- External visitors don't hit 404s
- SEO picks up the pages
- You can keep iterating content without shipping empty routes

### 2. Make coverage numbers live

Today the landing page has static numbers ("13 workers", "120+ tournaments"). Worth swapping in a server-side query at build time or revalidated every hour:

```ts
// In src/app/padelgodapi/page.tsx
export const revalidate = 3600
const supabase = createServiceClient()
const { count: tournamentCount } = await supabase
  .from('tournaments')
  .select('*', { count: 'exact', head: true })
  .gte('starts_at', '2026-01-01')
```

### 3. Per-worker detail pages

Right now `workers` is one big table. When the product grows, give each worker its own page with: algorithm detail, edge cases, observability queries, past incidents. Start with `static-reconciler` and `live-poller-manager` (the most complex).

### 4. Architecture diagram as real SVG (or Mermaid)

The current "FlowDiagram" component is a plain flex grid of boxes. It works but doesn't convey the full data flow. Swap in a hand-drawn SVG (export from Figma / Excalidraw) for the hero, keep the box grid as a fallback.

### 5. Search

Once content passes ~20 pages, add Algolia DocSearch (free for open-source/docs sites) or a simple cmdk modal with fuse.js over the frontmatter.

---

## Things to know (gotchas)

### Route placement

`/padelgodapi` is **outside** `[locale]/` because it's English-only dev docs. This mirrors how `/ops` is structured. If you ever want to translate, you'd move it under `[locale]/` and set up next-intl messages.

### Metadata + SEO

Each page has its own `metadata` export. The layout's `metadata` template is `'%s · PadelGod API'` so a page titled "Coverage" renders the tab as `Coverage · PadelGod API`. Keep that convention.

### No MDX

I considered MDX but rejected it for v0 — fewer deps, faster HMR, easier type-safety. If content-heavy editors start getting involved, reconsider: `@next/mdx` with the Next 16 app router works cleanly, and `src/app/padelgodapi/[slug]/page.tsx` can dynamically import MDX content from `content/padelgodapi/*.mdx`.

### Accessibility

- Sidebar has `aria-label`
- `<PrevNextLinks>` uses `<nav aria-label="Pagination">`
- Table headers use `<th>` with proper semantic markup
- Missing: skip-to-content link, focus-visible styling improvements, proper heading hierarchy audit on each page — worth a pass when the content stabilizes.

### Performance

All pages are server-rendered (RSC by default). Only `DocsSidebar` is a client component (needs `usePathname`). The bundle footprint is tiny — nothing beyond the Next.js runtime.

---

## Testing

No dedicated tests for these pages — they're content + layout, not logic. The right check is:

1. `npm run build` — must succeed (catches bad imports, type errors)
2. Manually click through each page at `localhost:3000/padelgodapi` — verify layout, nav highlight, mobile responsiveness
3. Tab through with keyboard — verify no keyboard traps
4. Run Lighthouse on `/padelgodapi/introduction` — should hit 100 performance + accessibility out of the box

---

## See also

- `docs/padelgodapi/SCOPE-B-PIPELINE-MIGRATION.md` — separate doc laying out the FIP entry-list pipeline migration from Vercel to padelgod. Referenced from the roadmap page.
- `src/app/padelgodapi/_lib/navigation.ts` — nav structure
- `src/app/globals.css` — design tokens
