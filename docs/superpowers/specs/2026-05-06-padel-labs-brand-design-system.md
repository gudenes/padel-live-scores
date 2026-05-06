# Padel Labs — Brand & Design System (Light Pass)

**Status:** Design (proposed)
**Author:** Claude (with @GuDenes brainstorming session 2026-05-06)
**Scope:** Light brand pass to anchor Phase 1 placeholder code. Deeper UX design for the chat experience (Phase 2) and the marketing site (Phase 5) gets its own brainstorm rounds when those phases land.
**Mockups:** [`.superpowers/brainstorm/10972-1778086621/content/`](../../../.superpowers/brainstorm/10972-1778086621/content/) (gitignored — these are exploration artifacts, not source of truth; this spec is the source of truth)

## 1. Decisions captured

| Decision | Value |
|---|---|
| Theme | **Light**, white-predominant |
| Reference inspiration | sentry.io (professionalism + craft level, NOT their purple) |
| Primary accent | **Lime** — `#84cc16` (Tailwind lime-500) |
| Neutrals | Zinc scale (Tailwind) |
| Typography | **System font stack only.** No custom font load. |
| Decorative iconography | **No emojis.** Typography + accent color carry visual weight. |
| Button style | **Sentry-inspired**: gradient fill, multi-layer shadow, lift on hover, satisfying press-in on click |
| Information architecture | **Multi-module platform**: `padellabs.tech` is the marketing umbrella; each module lives at `<module>.padellabs.tech` |
| Existing modules | `padelboard.padellabs.tech` (LIVE) |
| Next module | The chat product, working name **"Padel Analyst"** at `analyst.padellabs.tech` (naming open) |

## 2. Color palette

### Accent — Lime (Tailwind scale)

| Token | Hex | Use |
|---|---|---|
| `--lime-50` | `#f7fee7` | Faint backgrounds (eyebrow chips, hover tints) |
| `--lime-100` | `#ecfccb` | Soft fills (status badges, "LIVE" pill background) |
| `--lime-200` | `#d9f99d` | Borders on tinted surfaces |
| `--lime-300` | `#bef264` | Button hover state (top of gradient) |
| `--lime-400` | `#a3e635` | **Primary button — top of gradient** |
| `--lime-500` | `#84cc16` | **Primary accent** (logo, links, dot indicators) |
| `--lime-600` | `#65a30d` | Button active state, status text on tinted bg |
| `--lime-700` | `#4d7c0f` | Eyebrow / badge text on lime-tinted bg |
| `--lime-900` | `#1a2e05` | Text ON lime button (high contrast on lime fill) |

### Neutrals — Zinc

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#ffffff` | Page background (white-predominant) |
| `--surface` | `#fafafa` | Cards on hover, soft sections, inset surfaces |
| `--surface-2` | `#f4f4f5` | Tag/pill backgrounds, deeper insets |
| `--border` | `#e4e4e7` | Default borders |
| `--border-strong` | `#d4d4d8` | Buttons, inputs, hovered cards |
| `--text` | `#18181b` | Primary text, headings |
| `--text-muted` | `#52525b` | Secondary text, nav links |
| `--text-subtle` | `#71717a` | Tertiary text, captions, eyebrows on neutral bg |

**No dark theme in v1.** If/when we add one, it ships in a later phase.

## 3. Typography

System font stack only. Same stack across all surfaces.

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", monospace;
```

**Why system fonts:** zero loading cost, perfect rendering on every OS, no FOUT, matches the "professional infrastructure" feel. Custom display fonts deferred unless a strong brand argument emerges later.

### Type scale

| Token | Size | Line height | Letter spacing | Use |
|---|---|---|---|---|
| display-xl | 60px | 1.05 | -0.035em | Hero h1 |
| display-lg | 44px | 1.10 | -0.030em | Section h1 |
| h2 | 28px | 1.20 | -0.020em | Section heading |
| h3 | 17px | 1.30 | -0.015em | Card title |
| body-lg | 19px | 1.55 | normal | Hero subhead |
| body | 14–15px | 1.55 | normal | Default text |
| caption | 12–13px | 1.60 | normal | Caption, helper text |
| label | 12px | 1.20 | 0.12em uppercase | Section labels |
| eyebrow | 12px | 1.20 | 0.02em | Pill / chip text |
| mono | 12–13px | 1.40 | normal | Scores, code, domains |

Headings use **letter-spacing: negative** (-0.02 to -0.035em) for the tight, modern feel. Mono is for scores and domain names *only*, never body text.

## 4. Buttons (the Sentry-style satisfying ones)

### Primary

```css
.btn {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 14px;
  padding: 11px 22px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
  letter-spacing: -0.005em;
  transition: transform 0.12s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.12s cubic-bezier(0.4, 0, 0.2, 1),
              background 0.12s ease;
}

.btn-primary {
  background: linear-gradient(180deg, var(--lime-400) 0%, var(--lime-500) 100%);
  color: var(--lime-900);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.35),
    0 1px 2px rgba(26,46,5,0.12),
    0 4px 10px -2px rgba(132,204,22,0.32);
}
.btn-primary:hover {
  background: linear-gradient(180deg, var(--lime-300) 0%, var(--lime-400) 100%);
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.4),
    0 2px 4px rgba(26,46,5,0.14),
    0 10px 20px -4px rgba(132,204,22,0.45);
}
.btn-primary:active {
  transform: translateY(0);
  background: linear-gradient(180deg, var(--lime-500) 0%, var(--lime-600) 100%);
  box-shadow:
    inset 0 1px 2px rgba(26,46,5,0.2),
    0 1px 1px rgba(26,46,5,0.1);
}
```

### Secondary

```css
.btn-secondary {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border-strong);
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.btn-secondary:hover {
  background: var(--surface);
  border-color: #a1a1aa;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px -2px rgba(0,0,0,0.08);
}
.btn-secondary:active {
  transform: translateY(0);
  background: var(--surface-2);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.08);
}
```

**The "satisfying" mechanism:** three transitions running simultaneously — gradient swap, vertical translate, multi-layer shadow shift. The press-in inverts the inner highlight to an inner darken, which feels like the button is being depressed. This is the Sentry signature.

## 5. Spacing & sizing

Use 4-px scale throughout: `4, 8, 12, 16, 20, 24, 28, 36, 48, 64, 80, 96`. Avoid arbitrary values.

Border radii:
- Small (chips, badges): `4px`
- Default (buttons, inputs, small cards): `8px`
- Medium (cards, panels): `10–14px`
- Large (hero containers, modals): `16–20px`
- Pill: `999px`

## 6. Information architecture

### Multi-module platform

`padellabs.tech` is the **platform marketing umbrella**. Each module is its own subdomain with its own product surface, but they share brand identity, design tokens, and the underlying data foundation.

```
padellabs.tech                  → marketing umbrella; module showcase
├── padelboard.padellabs.tech   → live scores, rankings, tournaments (LIVE)
├── analyst.padellabs.tech      → AI chat + templates module (NEXT)
└── <future>.padellabs.tech     → scouting, broadcast graphics, federation widgets
```

**Implication for Phase 1:** the chat product we're scaffolding belongs at `analyst.padellabs.tech`, NOT at `app.padellabs.tech`. The marketing umbrella site at the apex is a **separate concern** and ships in Phase 5. For Phase 1 we deploy the chat module's app shell + login at `analyst.padellabs.tech` (or `app.padellabs.tech` as a temporary alias) and treat the apex as a future deliverable.

### Marketing landing composition (apex `padellabs.tech`)

For Phase 5 reference. Not in Phase 1 scope.

```
[ sticky nav: brand · Modules · Pricing · Docs · Blog · Sign in ]
  ↓
[ HERO: eyebrow chip · headline · subhead · primary + secondary CTA ]
  ↓
[ MODULES grid: 3-up cards, each with mark + status pill + name + 1-line + link + subdomain ]
  ↓
[ further sections deferred to Phase 5: data foundation, customer logos, pricing teaser, footer ]
```

## 7. Logo / brand mark

Placeholder direction:
- **Mark:** lime square (8px radius), lime gradient fill (lime-400 → lime-500), inner top highlight + soft outer glow, monospace "P" in `--lime-900`
- **Wordmark:** `padel labs` — lowercase, system font, weight 700, `padel` in `--text`, `labs` in `--text-subtle`, slight negative tracking

Custom logo design is **deferred** — the placeholder works for Phase 1 and the marketing pass in Phase 5 can iterate. We're not commissioning external design work in v1.

## 8. Module naming

| Module | Slug | Subdomain | Status |
|---|---|---|---|
| Padelboard | `padelboard` | `padelboard.padellabs.tech` | Live |
| **Padel Analyst** (placeholder) | `analyst` | `analyst.padellabs.tech` | Phase 1–5 build |

**"Padel Analyst" rationale:** speaks directly to the audience, not generic ("chat" / "ask"), follows the `padelboard` subdomain pattern, positions the user as an analyst when they use it. Naming is **open** — final commit by end of Phase 1 implementation.

Alternative names to consider:
- `Padel Insights` — `insights.padellabs.tech` (more aspirational, less audience-specific)
- `Padel Studio` — `studio.padellabs.tech` (creator-oriented framing)
- `Padel Sage` — `sage.padellabs.tech` (knowledge-positioning, but less obvious)

## 9. What this spec deliberately does NOT cover

These are **out of scope for this light pass** and get their own brainstorm rounds when the phases hit:

- Detailed chat UX (message bubbles, citation chip pattern, streaming animations) — **Phase 2 brainstorm**
- Template gallery + template runner UX — **Phase 3 brainstorm**
- Branded PNG card aesthetic (visual design of the share-cards) — **Phase 3 brainstorm**
- Marketing site sections beyond hero + modules grid (data foundation section, customer logos, pricing tables, footer) — **Phase 5 brainstorm**
- Pricing page composition — **Phase 4 brainstorm**
- Empty states / error states / loading states — handled per surface as built
- Custom logo design — deferred (placeholder is fine)
- Iconography library — only as needed; prefer typography over icons
- Dark theme — deferred entirely

## 10. Phase 1 plan implications

Phase 1 plan tasks 5, 6, 7, 8, 9 currently specify dark-theme placeholder UI with green-on-black. Those code blocks are now **superseded** — replace per the new tokens:

- `--background: #ffffff` (was `#0a0a0a`)
- `--text: #18181b` (was `#fafafa`)
- Primary CTA uses the Sentry-style `.btn-primary` from §4 (was a flat lime green block)
- Layout follows the multi-module umbrella pattern: marketing landing showcases modules; the chat app shell lives at `analyst.padellabs.tech` subdomain, NOT inside the apex marketing site

The Phase 1 plan is being updated alongside this commit to reflect these decisions.

## 11. References

- Mockup iteration 1 (color choice): `.superpowers/brainstorm/.../accent-color.html`
- Mockup iteration 2 (platform landing): `.superpowers/brainstorm/.../landing-platform.html`
- Inspiration: [sentry.io](https://sentry.io) — professionalism, craft level, button feel
- Existing module: [padelboard.padellabs.tech](https://padelboard.padellabs.tech)
- Parent v1 design: [`2026-05-06-padel-labs-v1-design.md`](2026-05-06-padel-labs-v1-design.md)
- Phase 1 plan: [`../plans/2026-05-06-padel-labs-v1-phase-1-foundation.md`](../plans/2026-05-06-padel-labs-v1-phase-1-foundation.md)
