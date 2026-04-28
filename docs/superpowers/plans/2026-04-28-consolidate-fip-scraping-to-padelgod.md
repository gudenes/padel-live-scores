# Consolidate FIP Scraping to Padelgod — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move FIP event-page enrichment (venue, prize money, matchscorer code, registration status, prize breakdown, schedule notes) from the Vercel `fip-tournaments` cron into a new padelgod worker, so padelgod is the single source of truth for FIP tournament discovery + enrichment.

**Architecture:** Padelgod's existing `tournament-discovery` worker keeps owning the WP-API listing pass. A new `fip-event-page-enricher` worker fetches the per-event HTML page, parses the rich fields, and writes them with a gap-fill exception so it can also fix the level-null Premier issue. The Vercel `fip-tournaments` cron is disabled; the parsers move from `src/lib/fip-scraper.ts` → `padelgod/src/parsers/fip-event-page-detail.ts`.

**Tech Stack:** TypeScript, Vitest, node-cron (Railway long-running service), Supabase JS client, Axios.

**Why this plan:**

- We have two parallel scrapers writing to `public.tournaments`. Today's audit showed the Vercel cron stamps slugs/fip_ids on padelapi rows, which then triggers padelgod's hourly upsert-by-slug. The interaction creates the level-null Premier problem (Asuncion P2 2026 disappeared from the home page).
- The user has reaffirmed: padelgod is the canonical scraper. Single ownership eliminates the "which scraper wrote this?" failure mode.
- Padelgod runs on Railway as a long-lived service → no Vercel function timeout concerns. Hourly cadence is faster than Vercel's 12h cron anyway.

**Out of scope (defer to follow-up plans):**

- Migrating `src/app/api/cron/fip-scores` (bracket scraper) — separate concern.
- Migrating ops endpoints (`seed-entry-list`, `seed-draw`, `parse-entry-list`) — operator-triggered, fine where they are.
- Migrating `widget-code-lookup` to read `public.tournaments.matchscorer_url` first — orthogonal optimisation, can ship separately.
- Deleting `src/lib/fip-scraper.ts` exports — other Vercel files still import them; cleanup is a later sweep.

---

## File Structure

**Create (in padelgod):**

- `padelgod/src/parsers/fip-event-page-detail.ts` — Pure parsers for the FIP event-page HTML (dates, matchscorer IDs, draw sizes, overview block, prize breakdown). Direct copy of the same parsers that live on Vercel today.
- `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts` — Unit tests with the same HTML fixtures we use on Vercel.
- `padelgod/src/__tests__/fixtures/fip-event-kl.html` — FIP Bronze Kuala Lumpur 2026 (full overview).
- `padelgod/src/__tests__/fixtures/fip-event-cyprus.html` — FIP Silver Cyprus I 2026 (full overview).
- `padelgod/src/__tests__/fixtures/fip-event-singapore-b3.html` — FIP Beyond B3 Singapore 2026 (alphanumeric eventID, oopbyday widget).
- `padelgod/src/workers/fip-event-page-enricher.ts` — The new hourly worker.
- `padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts` — Worker tests with mocked Supabase + Axios.

**Modify (in padelgod):**

- `padelgod/src/scheduler.ts` — Register the new worker (cron entry + feature flag).
- `padelgod/src/workers/tournament-discovery.ts` — Add gap-fill for `level` on Premier-tier rows (write only when existing is null) so the level-null bug stops happening on rediscovery.
- `padelgod/src/lib/fip-categories.ts` — Add a `resolvePremierLevel` helper (returns p1/p2/major/finals/fip_platinum) used by the gap-fill.

**Modify (in Vercel app):**

- `vercel.json` — Remove the `/api/cron/fip-tournaments` schedule.
- `src/app/api/cron/fip-tournaments/route.ts` — Replace with a stub that returns 410 Gone (keep the route file so any external monitor pinging it gets a clear "moved" signal; delete in a later cleanup PR).
- `CLAUDE.md` — Update the architecture description to reflect single-scraper ownership.

**Leave alone:**

- `src/lib/fip-scraper.ts` — Other Vercel files still import its parsers (`/api/admin/backfill-fip-overview`, `/api/admin/link-premier`, `/api/ops/*`). They keep working as long as those exports stay. Cleanup is a later PR.

---

## Task Decomposition

### Task 1: Copy HTML fixtures into padelgod

**Files:**
- Create: `padelgod/src/__tests__/fixtures/fip-event-kl.html`
- Create: `padelgod/src/__tests__/fixtures/fip-event-cyprus.html`
- Create: `padelgod/src/__tests__/fixtures/fip-event-singapore-b3.html`

- [ ] **Step 1: Copy fixtures from the Vercel test directory**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/lib/__tests__/fixtures/fip-event-kl.html \
   /Users/GuDenes/Projects/padel-live-scores/padelgod/src/__tests__/fixtures/fip-event-kl.html

cp /Users/GuDenes/Projects/padel-live-scores/src/lib/__tests__/fixtures/fip-event-cyprus.html \
   /Users/GuDenes/Projects/padel-live-scores/padelgod/src/__tests__/fixtures/fip-event-cyprus.html

cp /Users/GuDenes/Projects/padel-live-scores/src/lib/__tests__/fixtures/fip-event-singapore-b3.html \
   /Users/GuDenes/Projects/padel-live-scores/padelgod/src/__tests__/fixtures/fip-event-singapore-b3.html
```

- [ ] **Step 2: Verify fixtures are readable**

Run: `wc -c /Users/GuDenes/Projects/padel-live-scores/padelgod/src/__tests__/fixtures/*.html`
Expected: three lines, each with byte count > 0 (KL ~18KB, Cyprus ~20KB, Singapore ~1KB).

- [ ] **Step 3: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/__tests__/fixtures/fip-event-kl.html \
        padelgod/src/__tests__/fixtures/fip-event-cyprus.html \
        padelgod/src/__tests__/fixtures/fip-event-singapore-b3.html
git commit -m "test(padelgod): add FIP event-page HTML fixtures"
```

---

### Task 2: Add `parseEventDates` parser + tests in padelgod

**Files:**
- Create: `padelgod/src/parsers/fip-event-page-detail.ts`
- Create: `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseEventDates } from '../../parsers/fip-event-page-detail.js';

describe('parseEventDates', () => {
  it('parses DD/MM/YYYY range from header', () => {
    const html = '<div>15/03/2025 - 22/03/2025</div>';
    expect(parseEventDates(html)).toEqual({
      startsAt: '2025-03-15',
      endsAt: '2025-03-22',
    });
  });

  it('prefers the labelled "Main draw" date over the header range', () => {
    const html = `
      <p>PRACTICE: Available 20/04/2026 - 22/04/2026</p>
      <span>Main draw 25/04/2026</span>
      <span>Last day 30/04/2026</span>
    `;
    const result = parseEventDates(html);
    expect(result.startsAt).toBe('2026-04-25');
  });

  it('returns nulls when no dates appear', () => {
    expect(parseEventDates('<p>nothing here</p>')).toEqual({
      startsAt: null,
      endsAt: null,
    });
  });

  it('falls back to the first single date if no range is present', () => {
    const html = '<p>Date: 05/09/2025</p>';
    expect(parseEventDates(html)).toEqual({
      startsAt: '2025-09-05',
      endsAt: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/parsers/fip-event-page-detail.test.ts`
Expected: FAIL with "Cannot find module" or "parseEventDates is not exported".

- [ ] **Step 3: Create the parser file with `parseEventDates` only**

Create `padelgod/src/parsers/fip-event-page-detail.ts`:

```typescript
// Pure parsers for FIP padelfip.com event pages. Mirrors the parsers
// that previously lived in the Vercel app's src/lib/fip-scraper.ts.
//
// The Vercel `fip-tournaments` cron has been retired in favour of
// padelgod's `fip-event-page-enricher` worker (see this directory's
// sibling). These parsers run in both places during the migration —
// padelgod for ongoing scraping, Vercel for ad-hoc admin endpoints
// (link-premier, backfill-fip-overview). Cleanup of the Vercel
// duplicate is a follow-up PR.

export interface EventDates {
  startsAt: string | null; // ISO date YYYY-MM-DD
  endsAt: string | null;
}

/**
 * Read a labelled DD/MM/YYYY date from a "Tournament Structure" /
 * "Estructura del torneo" block.
 */
function findLabeledDate(html: string, label: string): string | null {
  const re = new RegExp(`${label}[^\\d]*(\\d{2})\\/(\\d{2})\\/(\\d{4})`, 'i');
  const m = re.exec(html);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}

export function parseEventDates(html: string): EventDates {
  const dateRangeRe =
    /(\d{2})\/(\d{2})\/(\d{4})\s*[-–—]\s*(\d{2})\/(\d{2})\/(\d{4})/;
  const rangeMatch = dateRangeRe.exec(html);
  const headerStart = rangeMatch
    ? `${rangeMatch[3]}-${rangeMatch[2]}-${rangeMatch[1]}`
    : null;
  const headerEnd = rangeMatch
    ? `${rangeMatch[6]}-${rangeMatch[5]}-${rangeMatch[4]}`
    : null;

  const mainDrawDate =
    findLabeledDate(html, 'Main\\s+draw') ??
    findLabeledDate(html, 'Cuadro\\s+principal');

  if (mainDrawDate) {
    return { startsAt: mainDrawDate, endsAt: headerEnd };
  }

  if (rangeMatch) {
    return { startsAt: headerStart, endsAt: headerEnd };
  }

  const singleRe = /(\d{2})\/(\d{2})\/(\d{4})/;
  const singleMatch = singleRe.exec(html);
  if (singleMatch) {
    const [, d, m, y] = singleMatch;
    return { startsAt: `${y}-${m}-${d}`, endsAt: null };
  }

  return { startsAt: null, endsAt: null };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/parsers/fip-event-page-detail.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/parsers/fip-event-page-detail.ts \
        padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts
git commit -m "feat(padelgod): port parseEventDates from Vercel scraper"
```

---

### Task 3: Add `parseMatchscorerIds` parser + tests

**Files:**
- Modify: `padelgod/src/parsers/fip-event-page-detail.ts`
- Modify: `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts`:

```typescript
import { parseMatchscorerIds } from '../../parsers/fip-event-page-detail.js';

describe('parseMatchscorerIds', () => {
  it('parses numeric eventID + builds FIP-{year}-{id} code', () => {
    const html = `
      const eventYear = "2025";
      const eventID = "3301";
      const totalday = 5;
    `;
    const result = parseMatchscorerIds(html);
    expect(result).toEqual({
      year: '2025',
      id: '3301',
      totalDays: 5,
      code: 'FIP-2025-3301',
      widget: 'draw',
    });
  });

  it('accepts alphanumeric eventID for FIP Beyond / Promises', () => {
    const html = `
      const eventYear = "2026";
      const eventID   = "B0118";
      const totalday  = 4;
      const widget    = 'oopbyday';
    `;
    const result = parseMatchscorerIds(html);
    expect(result?.id).toBe('B0118');
    expect(result?.code).toBe('FIP-2026-B0118');
    expect(result?.widget).toBe('oopbyday');
    expect(result?.totalDays).toBe(4);
  });

  it('returns null when eventID is missing', () => {
    expect(parseMatchscorerIds('<p>no js block</p>')).toBeNull();
  });

  it('defaults widget to "draw" when not declared', () => {
    const html = 'const eventYear="2025";const eventID="42";const totalday=1;';
    expect(parseMatchscorerIds(html)?.widget).toBe('draw');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/parsers/fip-event-page-detail.test.ts`
Expected: 4 new tests fail with "parseMatchscorerIds is not exported".

- [ ] **Step 3: Implement `parseMatchscorerIds`**

Append to `padelgod/src/parsers/fip-event-page-detail.ts`:

```typescript
export interface MatchscorerIds {
  year: string;
  id: string;
  totalDays: number;
  code: string; // e.g. "FIP-2025-3301", "FIP-2026-B0118"
  /**
   * Crionet matchscorerlive widget type — drives which `/screen/<widget>/`
   * URL is used downstream:
   *   - 'draw'      — Bronze/Silver/Gold/Premier (numeric eventID)
   *   - 'oopbyday'  — FIP Beyond / Promises (alphanumeric IDs like B0118)
   * Defaults to 'draw' when the page doesn't declare `const widget`.
   */
  widget: string;
}

export function parseMatchscorerIds(html: string): MatchscorerIds | null {
  const yearMatch = /const\s+eventYear\s*=\s*["'](\d+)["']/.exec(html);
  const idMatch = /const\s+eventID\s*=\s*["']([A-Za-z0-9]+)["']/.exec(html);
  const daysMatch = /const\s+totalday\s*=\s*(\d+)/.exec(html);
  const widgetMatch = /const\s+widget\s*=\s*["']([a-z]+)["']/.exec(html);

  if (!yearMatch || !idMatch) return null;

  const year = yearMatch[1]!;
  const id = idMatch[1]!;
  const totalDays = daysMatch ? parseInt(daysMatch[1]!, 10) : 1;
  const widget = widgetMatch ? widgetMatch[1]! : 'draw';

  return {
    year,
    id,
    totalDays,
    code: `FIP-${year}-${id}`,
    widget,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/parsers/fip-event-page-detail.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/parsers/fip-event-page-detail.ts \
        padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts
git commit -m "feat(padelgod): port parseMatchscorerIds (alphanumeric eventID + widget)"
```

---

### Task 4: Add `parseDrawSizes`, `parseOverviewFields`, `parsePrizeBreakdown`

**Files:**
- Modify: `padelgod/src/parsers/fip-event-page-detail.ts`
- Modify: `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts`

- [ ] **Step 1: Add failing tests for all three parsers**

Append to `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseDrawSizes,
  parseOverviewFields,
  parsePrizeBreakdown,
} from '../../parsers/fip-event-page-detail.js';

const fixtureDir = join(__dirname, '..', 'fixtures');
const klHtml = readFileSync(join(fixtureDir, 'fip-event-kl.html'), 'utf8');
const cyprusHtml = readFileSync(join(fixtureDir, 'fip-event-cyprus.html'), 'utf8');

describe('parseDrawSizes', () => {
  it('reads "Prize Money X€" suffix format (Bronze/Silver/Gold)', () => {
    const html = `
      <th>Prize Money</th><td>10,000€</td>
    `;
    expect(parseDrawSizes(html).prizeMoney).toBe(10000);
  });

  it('reads "Prize Money €X" prefix format (Premier)', () => {
    const html = `
      <span class="overview__title">Prize Money</span>
      <p>€264.534</p>
    `;
    expect(parseDrawSizes(html).prizeMoney).toBe(264534);
  });

  it('returns null when no labelled "Prize Money" appears', () => {
    // Sign-up fee should NOT leak into prize_money_fip.
    const html = `
      <span class="overview__title">Sign Up Fee</span>
      <p>60 € per player/category</p>
    `;
    expect(parseDrawSizes(html).prizeMoney).toBeNull();
  });

  it('reads main draw + qualifying draw from labelled fields', () => {
    const html = 'Main draw: 32 (26DA+4Q+2WC); Qualification draw: 16 (14DA+2WC)';
    const result = parseDrawSizes(html);
    expect(result.mainDraw).toBe(32);
    expect(result.qualifyingDraw).toBe(16);
  });
});

describe('parseOverviewFields', () => {
  it('reads venue + address + court conditions + registration status (KL fixture)', () => {
    const fields = parseOverviewFields(klHtml);
    expect(fields.venue).toBe('Pop Padel Kuala Lumpur');
    expect(fields.venueAddress).toContain('Kuala Lumpur');
    expect(fields.venueType).toBe('covered');
    expect(fields.registrationStatus).toBe('closed');
    expect(fields.signupFeeEur).toBe(40);
  });

  it('captures multiline schedule notes (Play Order block)', () => {
    const fields = parseOverviewFields(klHtml);
    expect(fields.scheduleNotes).toBeTruthy();
    expect(fields.scheduleNotes!.split('\\n').length).toBeGreaterThan(3);
  });

  it('returns all-null when no overview block is present', () => {
    expect(parseOverviewFields('<html><body><p>nothing</p></body></html>')).toEqual({
      registrationStatus: null,
      signupFeeEur: null,
      venue: null,
      venueAddress: null,
      venueType: null,
      scheduleNotes: null,
    });
  });
});

describe('parsePrizeBreakdown', () => {
  it('parses all six rounds from the prize-distribution table (KL fixture)', () => {
    const breakdown = parsePrizeBreakdown(klHtml);
    expect(breakdown).not.toBeNull();
    expect(breakdown!.r32).toBe(0);
    expect(breakdown!.r16).toBe(0);
    expect(breakdown!.qf).toBe(111.56);
    expect(breakdown!.sf).toBe(212.5);
    expect(breakdown!.finalist).toBe(446.25);
    expect(breakdown!.winner).toBe(807.5);
    expect(breakdown!.currency).toBe('EUR');
    expect(breakdown!.per).toBe('player');
    expect(breakdown!.source).toBe('scraped');
  });

  it('returns null when no prize-distribution table exists', () => {
    expect(parsePrizeBreakdown('<html><body></body></html>')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/parsers/fip-event-page-detail.test.ts`
Expected: 9 new tests fail.

- [ ] **Step 3: Implement the three parsers**

Append to `padelgod/src/parsers/fip-event-page-detail.ts`:

```typescript
export interface DrawSize {
  mainDraw: number | null;
  qualifyingDraw: number | null;
  prizeMoney: number | null; // euros
}

export interface OverviewFields {
  registrationStatus: string | null; // 'open' | 'closed' | 'upcoming' | …
  signupFeeEur: number | null;
  venue: string | null;
  venueAddress: string | null;
  venueType: string | null; // 'covered' | 'outdoor'
  scheduleNotes: string | null;
}

export interface PrizeBreakdown {
  r32?: number;
  r16?: number;
  qf?: number;
  sf?: number;
  finalist?: number;
  winner?: number;
  currency: 'EUR';
  per: 'player';
  source: 'scraped' | 'inferred';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&apos;/g, "'");
}

export function parseDrawSizes(html: string): DrawSize {
  const mdMatch = /[Mm]ain\\s*[Dd]raw[:\\s]*(\\d+)/i.exec(html);
  const mainDraw = mdMatch ? parseInt(mdMatch[1]!, 10) : null;

  const qdMatch = /[Qq]ualif(?:ication|ying)\\s*[Dd]raw[:\\s]*(\\d+)/i.exec(html);
  const qualifyingDraw = qdMatch ? parseInt(qdMatch[1]!, 10) : null;

  // Labelled "Prize Money" only — both suffix and prefix € formats.
  // No unlabelled fallback (FIP Beyond pages have a Sign Up Fee that
  // would otherwise leak through).
  let prizeMoney: number | null = null;
  const labeledSuffix = /Prize\\s*Money[^\\d]*(\\d[\\d.,]*)\\s*€/i;
  const labeledPrefix = /Prize\\s*Money[^€]*€\\s*(\\d[\\d.,]*)/i;
  const prizeMatch = labeledSuffix.exec(html) ?? labeledPrefix.exec(html);
  if (prizeMatch) {
    const cleaned = prizeMatch[1]!.replace(/[.,]/g, '');
    const val = parseInt(cleaned, 10);
    if (val > 0 && val < 10_000_000) prizeMoney = val;
  }

  return { mainDraw, qualifyingDraw, prizeMoney };
}

function findOverviewValue(html: string, label: string): string | null {
  const labelEsc = escapeRegex(label);
  const re = new RegExp(
    `overview__title[^>]*>\\\\s*${labelEsc}\\\\s*:?\\\\s*<\\\\/span>[\\\\s\\\\S]{0,800}?overview__text[^>]*>([\\\\s\\\\S]*?)<\\\\/(?:p|div)>`,
    'i',
  );
  const m = re.exec(html);
  if (!m) return null;
  const text = decodeHtmlEntities(stripTags(m[1]!)).replace(/\\s+/g, ' ').trim();
  return text || null;
}

export function parseOverviewFields(html: string): OverviewFields {
  const regRe = /overview__title[^>]*>\\s*Registration\\s+([A-Za-z]+)\\s*<\\/span>/i;
  const regMatch = regRe.exec(html);
  const registrationStatus = regMatch ? regMatch[1]!.toLowerCase() : null;

  const feeText = findOverviewValue(html, 'Sign Up Fee');
  let signupFeeEur: number | null = null;
  if (feeText) {
    const m = /(\\d[\\d.,]*)/.exec(feeText);
    if (m) {
      const cleaned = m[1]!.replace(/[.,]/g, '');
      const val = parseInt(cleaned, 10);
      if (val >= 0 && val < 10_000) signupFeeEur = val;
    }
  }

  const courtRaw = findOverviewValue(html, 'Court conditions');
  const venueType = courtRaw ? courtRaw.toLowerCase() : null;
  const venue = findOverviewValue(html, 'Venue');
  const venueAddress = findOverviewValue(html, 'Address');

  const playOrderRe =
    /overview__title[^>]*>\\s*Play\\s*Order\\s*:?\\s*<\\/span>[\\s\\S]{0,400}?overview__listText[^>]*>([\\s\\S]*?)<\\/div>/i;
  const playMatch = playOrderRe.exec(html);
  let scheduleNotes: string | null = null;
  if (playMatch) {
    const withBreaks = playMatch[1]!.replace(/<br\\s*\\/?>/gi, '\\n');
    scheduleNotes =
      decodeHtmlEntities(stripTags(withBreaks))
        .split('\\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\\n') || null;
  }

  return {
    registrationStatus,
    signupFeeEur,
    venue,
    venueAddress,
    venueType,
    scheduleNotes,
  };
}

type RoundKey = 'r32' | 'r16' | 'qf' | 'sf' | 'finalist' | 'winner';

function roundLabelToKey(label: string): RoundKey | null {
  if (label === 'R32' || label === 'ROUND 32') return 'r32';
  if (label === 'R16' || label === 'ROUND 16') return 'r16';
  if (
    label === 'QF' ||
    label === '1/4 FINAL' ||
    label === '1/4FINAL' ||
    label === 'QUARTERFINAL' ||
    label === 'QUARTER FINAL'
  )
    return 'qf';
  if (
    label === 'SF' ||
    label === '1/2 FINAL' ||
    label === '1/2FINAL' ||
    label === 'SEMIFINAL' ||
    label === 'SEMI FINAL'
  )
    return 'sf';
  if (label === 'FINALIST' || label === 'RUNNER UP' || label === 'RUNNER-UP')
    return 'finalist';
  if (label === 'WINNER' || label === 'CHAMPION') return 'winner';
  return null;
}

export function parsePrizeBreakdown(html: string): PrizeBreakdown | null {
  const rowRe =
    /<th[^>]*scope="row"[^>]*>\\s*([^<]+?)\\s*<\\/th>\\s*<td[^>]*>\\s*€?\\s*([0-9][\\d.,]*)\\s*€?\\s*<\\/td>/gi;

  const rounds: Partial<Record<RoundKey, number>> = {};
  let hits = 0;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const label = m[1]!.toUpperCase().replace(/\\s+/g, ' ').trim();
    const key = roundLabelToKey(label);
    if (!key) continue;
    const raw = m[2]!.replace(/,/g, '');
    const amount = Number.parseFloat(raw);
    if (!Number.isFinite(amount) || amount < 0) continue;
    rounds[key] = Math.round(amount * 100) / 100;
    hits++;
  }

  if (hits === 0) return null;
  return { ...rounds, currency: 'EUR', per: 'player', source: 'scraped' };
}
```

- [ ] **Step 4: Run all parser tests, verify pass**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/parsers/fip-event-page-detail.test.ts`
Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/parsers/fip-event-page-detail.ts \
        padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts
git commit -m "feat(padelgod): port parseDrawSizes/Overview/PrizeBreakdown parsers"
```

---

### Task 5: Add `resolvePremierLevel` helper to fip-categories

**Files:**
- Modify: `padelgod/src/lib/fip-categories.ts`
- Modify: `padelgod/src/__tests__/lib/fip-categories.test.ts` (or create if missing)

- [ ] **Step 1: Check if a test file exists**

Run: `ls padelgod/src/__tests__/lib/ 2>/dev/null | grep fip-categories`

If empty, create `padelgod/src/__tests__/lib/fip-categories.test.ts` in step 2.

- [ ] **Step 2: Write failing test**

Create or append to `padelgod/src/__tests__/lib/fip-categories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  resolveFipLevel,
  resolvePremierLevel,
} from '../../lib/fip-categories.js';

describe('resolvePremierLevel', () => {
  it('maps Premier WP category IDs to their level codes', () => {
    expect(resolvePremierLevel([24], 'paris-major-2026')).toBe('major');     // FIP-PPT-MAJOR
    expect(resolvePremierLevel([25], 'madrid-p1-2026')).toBe('p1');           // FIP-PPT-P1
    expect(resolvePremierLevel([387], 'newgiza-p2-2026')).toBe('p2');         // FIP-PP-P2
    expect(resolvePremierLevel([306], 'premier-padel-finals-2026')).toBe('finals'); // FIP-PP-MASTER-FINALS
    expect(resolvePremierLevel([18], 'fip-platinum-lyon-2026')).toBe('fip_platinum'); // FIP-TOUR-PLATINUM
  });

  it('returns null for non-Premier categories (Bronze/Silver/Gold)', () => {
    expect(resolvePremierLevel([19], 'fip-gold-andorra-2025')).toBeNull();
    expect(resolvePremierLevel([496], 'fip-silver-madrid-2025')).toBeNull();
    expect(resolvePremierLevel([497], 'fip-bronze-istanbul-2026')).toBeNull();
  });

  it('returns null for empty category list', () => {
    expect(resolvePremierLevel([], 'something-2026')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/lib/fip-categories.test.ts`
Expected: FAIL with "resolvePremierLevel is not exported".

- [ ] **Step 4: Add the helper**

Append to `padelgod/src/lib/fip-categories.ts`:

```typescript
/**
 * Premier-tier WP category IDs and their level codes. Used by
 * tournament-discovery + fip-event-page-enricher as a gap-fill: when
 * an existing tournament row has level=null AND the WP event maps to
 * a Premier-tier category, write the level. Padelapi remains the
 * primary owner of Premier levels — this only fills nulls.
 */
const FIP_PREMIER_CATEGORY_TO_LEVEL: Record<number, string> = {
  18: 'fip_platinum',  // FIP-TOUR-PLATINUM
  24: 'major',          // FIP-PPT-MAJOR
  25: 'p1',             // FIP-PPT-P1
  306: 'finals',        // FIP-PP-MASTER-FINALS
  387: 'p2',            // FIP-PP-P2
};

export function resolvePremierLevel(
  categoryTermIds: readonly number[],
  _slug: string,
): string | null {
  for (const id of categoryTermIds) {
    const level = FIP_PREMIER_CATEGORY_TO_LEVEL[id];
    if (level) return level;
  }
  return null;
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/lib/fip-categories.test.ts`
Expected: all 3 new tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/lib/fip-categories.ts \
        padelgod/src/__tests__/lib/fip-categories.test.ts
git commit -m "feat(padelgod): add resolvePremierLevel helper for level gap-fill"
```

---

### Task 6: Wire Premier gap-fill into `tournament-discovery`

**Files:**
- Modify: `padelgod/src/workers/tournament-discovery.ts:75-95` (the row construction block)
- Modify: `padelgod/src/__tests__/workers/tournament-discovery.test.ts` (if exists; otherwise inline the assertion in an existing test)

This task fixes the user-visible bug: Asuncion P2 2026 (and similar Premier rows) lose visibility because padelapi never set level. With this gap-fill, padelgod's hourly tournament-discovery run sets level when WP knows the tier AND the existing row has null.

- [ ] **Step 1: Read the existing tournament-discovery row-construction block**

Run: `sed -n '70,95p' padelgod/src/workers/tournament-discovery.ts`

Confirm the current logic builds:
```ts
const level = resolveFipLevel(p.categoryTermIds, p.slug);
if (level) row.level = level;
```

The new logic must additionally consult `resolvePremierLevel` and only write it when the existing row has level=null.

- [ ] **Step 2: Write failing test**

Add to `padelgod/src/__tests__/workers/tournament-discovery.test.ts` (create the file from scratch if it doesn't already exist; mirror the structure of `static-reconciler.test.ts`):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runTournamentDiscovery } from '../../workers/tournament-discovery.js';

describe('runTournamentDiscovery — Premier gap-fill', () => {
  it('writes level for a new Premier-tier row when existing has null', async () => {
    const upserted: any[] = [];
    const supabase = makeMockSupabase({
      // existing row has level=null
      existingRows: [
        { slug: 'newgiza-p2-2026', level: null },
      ],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp([
      { wpId: 1, name: 'NewGiza P2', slug: 'newgiza-p2-2026', categoryIds: [387] },
    ]);

    await runTournamentDiscovery({ supabase, httpClient });

    const newgiza = upserted.find((r) => r.slug === 'newgiza-p2-2026');
    expect(newgiza?.level).toBe('p2');
  });

  it('does NOT overwrite level when existing row already has it', async () => {
    const upserted: any[] = [];
    const supabase = makeMockSupabase({
      existingRows: [
        { slug: 'newgiza-p2-2026', level: 'p2' },
      ],
      onUpsert: (rows) => upserted.push(...rows),
    });
    const httpClient = makeMockHttp([
      { wpId: 1, name: 'NewGiza P2', slug: 'newgiza-p2-2026', categoryIds: [387] },
    ]);

    await runTournamentDiscovery({ supabase, httpClient });

    const newgiza = upserted.find((r) => r.slug === 'newgiza-p2-2026');
    // level should NOT be in the patch — leave existing 'p2' alone
    expect(newgiza?.level).toBeUndefined();
  });
});

// Test-fixture helpers (mock Supabase that records upserts + handles
// the existing-row lookup the worker does for gap-fill)
function makeMockSupabase(opts: { existingRows: Array<{ slug: string; level: string | null }>; onUpsert: (rows: any[]) => void }) {
  return {
    from: (table: string) => ({
      select: () => ({
        order: () => ({
          limit: () => ({ maybeSingle: async () => ({ data: null }) }),
        }),
        in: async () => ({ data: opts.existingRows.map((r) => ({ slug: r.slug, level: r.level })) }),
      }),
      upsert: async (rows: any[]) => { opts.onUpsert(rows); return { error: null }; },
    }),
  } as any;
}

function makeMockHttp(events: Array<{ wpId: number; name: string; slug: string; categoryIds: number[] }>) {
  return {
    get: async () => ({
      data: events.map((e) => ({
        id: e.wpId,
        title: { rendered: e.name },
        slug: e.slug,
        link: `https://www.padelfip.com/events/${e.slug}/`,
        featured_media: 0,
        'category-event': e.categoryIds,
        country: [],
        gender: [],
      })),
      headers: {},
    }),
  } as any;
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/workers/tournament-discovery.test.ts`
Expected: tests fail (the gap-fill logic isn't there yet).

- [ ] **Step 4: Add the gap-fill to the worker**

Modify `padelgod/src/workers/tournament-discovery.ts` — replace the import + row-construction block:

Replace the import line:
```typescript
import { resolveFipLevel } from '../lib/fip-categories.js';
```
with:
```typescript
import { resolveFipLevel, resolvePremierLevel } from '../lib/fip-categories.js';
```

Replace the existing `const rows = parsed.map(...)` block (lines ~70-95 — find by searching for `parsed.map`) with:

```typescript
// Pre-fetch existing rows so we can apply the Premier gap-fill: write
// `level` only when the existing row has null (padelapi remains the
// primary owner — but if padelapi never wrote, our WP-derived level
// keeps the row visible in the public app).
const slugs = parsed.map((p) => p.slug).filter((s): s is string => !!s);
const { data: existing } = slugs.length > 0
  ? await deps.supabase.from('tournaments').select('slug, level').in('slug', slugs)
  : { data: [] };
const existingLevelBySlug = new Map<string, string | null>(
  ((existing ?? []) as Array<{ slug: string; level: string | null }>).map(
    (r) => [r.slug, r.level],
  ),
);

const rows = parsed.map((p) => {
  const level = resolveFipLevel(p.categoryTermIds, p.slug);
  const row: Record<string, unknown> = {
    name: p.name,
    slug: p.slug,
    source: 'fip',
    last_updated_by: 'padelgod',
  };
  if (level) {
    // Authoritative tier (non-Premier) — always write.
    row.level = level;
  } else {
    // Premier-tier — gap-fill only. Don't clobber padelapi's value.
    const premierLevel = resolvePremierLevel(p.categoryTermIds, p.slug);
    const existingLevel = existingLevelBySlug.get(p.slug);
    if (premierLevel && (existingLevel == null || existingLevel === '')) {
      row.level = premierLevel;
    }
  }
  return row;
});
```

- [ ] **Step 5: Run test, verify pass**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/workers/tournament-discovery.test.ts`
Expected: 2 new tests pass. Existing tests still pass.

- [ ] **Step 6: Run full padelgod suite to catch regressions**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/workers/tournament-discovery.ts \
        padelgod/src/__tests__/workers/tournament-discovery.test.ts
git commit -m "fix(padelgod): gap-fill level for Premier rows missing it

Asuncion P2 2026 disappeared from the public app today because
padelapi never set its level. Tournament-discovery now writes the
WP-derived Premier level (p1/p2/major/finals/fip_platinum) only
when the existing row has null — padelapi stays the primary owner
when it has set a value."
```

---

### Task 7: Scaffold the `fip-event-page-enricher` worker

**Files:**
- Create: `padelgod/src/workers/fip-event-page-enricher.ts`
- Create: `padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts`

- [ ] **Step 1: Write the failing test for the worker's "needs enrichment" filter**

Create `padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { needsEnrichment, type TournamentRow } from '../../workers/fip-event-page-enricher.js';

describe('needsEnrichment', () => {
  const baseRow: TournamentRow = {
    id: 't1',
    slug: 'fip-bronze-test-2026',
    fip_id: 'fip-bronze-test-2026',
    matchscorer_url: null,
    starts_at: null,
    ends_at: null,
    venue: null,
    registration_status: null,
    prize_money_fip: null,
    prize_breakdown: null,
    level: null,
  };

  it('returns true when matchscorer_url is missing', () => {
    expect(needsEnrichment({ ...baseRow, matchscorer_url: null })).toBe(true);
  });

  it('returns true when starts_at is missing', () => {
    expect(needsEnrichment({ ...baseRow, matchscorer_url: 'X', starts_at: null })).toBe(true);
  });

  it('returns true when venue is missing', () => {
    expect(needsEnrichment({ ...baseRow, matchscorer_url: 'X', starts_at: '2026-04-01', ends_at: '2026-04-07', venue: null })).toBe(true);
  });

  it('returns false when all enrichable fields are populated', () => {
    expect(needsEnrichment({
      ...baseRow,
      matchscorer_url: 'FIP-2026-1234',
      starts_at: '2026-04-01',
      ends_at: '2026-04-07',
      venue: 'Some Club',
      registration_status: 'closed',
      prize_money_fip: 10000,
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/workers/fip-event-page-enricher.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create the worker file with `needsEnrichment` only**

Create `padelgod/src/workers/fip-event-page-enricher.ts`:

```typescript
// Padelgod worker: fetch each FIP event page, parse the rich overview
// fields (venue, prize money, matchscorer code, registration status,
// prize breakdown, schedule notes), and write them to public.tournaments.
//
// Replaces the Vercel `/api/cron/fip-tournaments` cron's enrichment
// pass — discovery itself stays in padelgod's `tournament-discovery`
// worker (the WP-listing pass).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';

export interface FipEventPageEnricherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface FipEventPageEnricherResult {
  candidates: number;
  enriched: number;
  errors: number;
}

export interface TournamentRow {
  id: string;
  slug: string | null;
  fip_id: string | null;
  matchscorer_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  venue: string | null;
  registration_status: string | null;
  prize_money_fip: number | null;
  prize_breakdown: unknown;
  level: string | null;
}

/**
 * A row needs enrichment if any of the fields the FIP event page
 * exposes is still null. Re-fetching is cheap; the upstream HTML is
 * static for finished events.
 */
export function needsEnrichment(row: TournamentRow): boolean {
  if (row.matchscorer_url == null) return true;
  if (row.starts_at == null) return true;
  if (row.ends_at == null) return true;
  if (row.venue == null) return true;
  if (row.registration_status == null) return true;
  if (row.prize_money_fip == null) return true;
  return false;
}

export async function runFipEventPageEnricher(
  _deps: FipEventPageEnricherDeps,
): Promise<FipEventPageEnricherResult> {
  // Implementation lands in Task 8.
  return { candidates: 0, enriched: 0, errors: 0 };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/workers/fip-event-page-enricher.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/workers/fip-event-page-enricher.ts \
        padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts
git commit -m "feat(padelgod): scaffold fip-event-page-enricher worker"
```

---

### Task 8: Implement the enrichment loop (fetch + parse + write)

**Files:**
- Modify: `padelgod/src/workers/fip-event-page-enricher.ts`
- Modify: `padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts`

- [ ] **Step 1: Write failing test for end-to-end enrichment**

Append to `padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts`:

```typescript
import { runFipEventPageEnricher } from '../../workers/fip-event-page-enricher.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const klHtml = readFileSync(join(__dirname, '..', 'fixtures', 'fip-event-kl.html'), 'utf8');

describe('runFipEventPageEnricher — end to end', () => {
  it('fetches the FIP page, parses fields, and writes them to the row', async () => {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const supabase = {
      from: (table: string) => {
        if (table === 'tournaments') {
          return {
            select: () => ({
              or: () => ({
                limit: async () => ({
                  data: [
                    {
                      id: 'kl-id',
                      slug: 'fip-bronze-kuala-lumpur-2026',
                      fip_id: 'fip-bronze-kuala-lumpur-2026',
                      matchscorer_url: null,
                      starts_at: null,
                      ends_at: null,
                      venue: null,
                      registration_status: null,
                      prize_money_fip: null,
                      prize_breakdown: null,
                      level: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                updates.push({ id, patch });
                return { error: null };
              },
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    } as any;

    const httpClient = {
      get: async () => ({ data: klHtml, headers: {} }),
    } as any;

    const result = await runFipEventPageEnricher({ supabase, httpClient });

    expect(result.enriched).toBe(1);
    expect(result.errors).toBe(0);
    expect(updates).toHaveLength(1);
    const patch = updates[0]!.patch;
    expect(patch.matchscorer_url).toBeTruthy();  // KL has FIP-{year}-{id}
    expect(patch.venue).toBe('Pop Padel Kuala Lumpur');
    expect(patch.registration_status).toBe('closed');
    expect(patch.prize_money_fip).toBe(8500);
    expect(patch.starts_at).toBeTruthy();
    expect(patch.last_updated_by).toBe('padelgod');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/workers/fip-event-page-enricher.test.ts`
Expected: FAIL — `result.enriched === 0`.

- [ ] **Step 3: Implement the worker body**

Replace the placeholder `runFipEventPageEnricher` in `padelgod/src/workers/fip-event-page-enricher.ts`:

```typescript
import {
  parseEventDates,
  parseMatchscorerIds,
  parseDrawSizes,
  parseOverviewFields,
  parsePrizeBreakdown,
} from '../parsers/fip-event-page-detail.js';

const FIP_BASE = 'https://www.padelfip.com';
const PAGE_FETCH_HEADERS = { 'User-Agent': 'PadelNachos/1.0 (padelgod)' };
const ENRICH_BATCH_LIMIT = 200;

function buildEventPageUrl(slug: string): string {
  return `${FIP_BASE}/events/${slug}/`;
}

/** Strip the leading 'fip-' prefix off fip_id to get the WP slug. */
function fipIdToSlug(fipId: string | null): string | null {
  if (!fipId) return null;
  return fipId.startsWith('fip-') ? fipId.slice(4) : fipId;
}

export async function runFipEventPageEnricher(
  deps: FipEventPageEnricherDeps,
): Promise<FipEventPageEnricherResult> {
  // 1. Load tournaments that might need enrichment. Filter:
  //    - source = 'fip' OR fip_id IS NOT NULL (we have a way to fetch)
  //    - ends_at IS NULL OR ends_at > now() - 14 days (skip old archives)
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await deps.supabase
    .from('tournaments')
    .select(
      'id, slug, fip_id, matchscorer_url, starts_at, ends_at, venue, ' +
      'registration_status, prize_money_fip, prize_breakdown, level',
    )
    .or(`source.eq.fip,fip_id.not.is.null`)
    .or(`ends_at.is.null,ends_at.gte.${cutoff}`)
    .limit(ENRICH_BATCH_LIMIT);
  if (error) throw new Error(`tournaments read failed: ${error.message}`);

  const candidates = (rows ?? []) as TournamentRow[];
  const targets = candidates.filter(needsEnrichment);

  let enriched = 0;
  let errors = 0;

  for (const t of targets) {
    const slug = t.slug ?? fipIdToSlug(t.fip_id);
    if (!slug) continue;

    try {
      const url = buildEventPageUrl(slug);
      const resp = await deps.httpClient.get(url, { headers: PAGE_FETCH_HEADERS });
      const html = String(resp.data);

      const dates = parseEventDates(html);
      const matchscorer = parseMatchscorerIds(html);
      const drawSize = parseDrawSizes(html);
      const overview = parseOverviewFields(html);
      const prizeBreakdown = parsePrizeBreakdown(html);

      const patch: Record<string, unknown> = {
        last_updated_by: 'padelgod',
        updated_at: new Date().toISOString(),
      };

      // Gap-fill: only write fields where the existing row is null.
      // We don't want to overwrite manual operator edits or padelapi-
      // primary fields like name/level/country.
      if (t.starts_at == null && dates.startsAt) patch.starts_at = dates.startsAt;
      if (t.ends_at == null && dates.endsAt) patch.ends_at = dates.endsAt;
      if (t.matchscorer_url == null && matchscorer?.code) {
        patch.matchscorer_url = matchscorer.code;
      }
      if (t.venue == null && overview.venue) patch.venue = overview.venue;
      if (t.registration_status == null && overview.registrationStatus) {
        patch.registration_status = overview.registrationStatus;
      }
      if (t.prize_money_fip == null && drawSize.prizeMoney) {
        patch.prize_money_fip = drawSize.prizeMoney;
      }
      if (t.prize_breakdown == null && prizeBreakdown) {
        patch.prize_breakdown = prizeBreakdown;
      }

      // Refresh registration_status on every pass for upcoming events
      // (it changes during life-cycle: open → closed). Override the
      // gap-fill above when the event hasn't ended yet.
      const endsAtMs = t.ends_at ? Date.parse(t.ends_at) : null;
      const isCurrentOrFuture =
        endsAtMs == null || endsAtMs > Date.now() - 24 * 60 * 60 * 1000;
      if (isCurrentOrFuture && overview.registrationStatus) {
        patch.registration_status = overview.registrationStatus;
      }

      // Only update if there's something beyond the bookkeeping fields.
      const writeKeys = Object.keys(patch).filter(
        (k) => k !== 'last_updated_by' && k !== 'updated_at',
      );
      if (writeKeys.length === 0) continue;

      const { error: updErr } = await deps.supabase
        .from('tournaments')
        .update(patch)
        .eq('id', t.id);
      if (updErr) throw new Error(`update failed: ${updErr.message}`);
      enriched++;
    } catch {
      errors++;
    }
  }

  return { candidates: candidates.length, enriched, errors };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/workers/fip-event-page-enricher.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/workers/fip-event-page-enricher.ts \
        padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts
git commit -m "feat(padelgod): implement fip-event-page-enricher fetch+parse+write loop"
```

---

### Task 9: Register the worker in the scheduler

**Files:**
- Modify: `padelgod/src/scheduler.ts`
- Modify: `padelgod/src/__tests__/scheduler.test.ts` (if present)

- [ ] **Step 1: Read the current scheduler structure**

Run: `grep -nE "tournament-discovery|name: '|cron:|getWorkerRunner|enableTournamentDiscovery" padelgod/src/scheduler.ts | head -30`

Note the pattern: feature-flag → registration block → cron schedule.

- [ ] **Step 2: Write failing test**

Add to `padelgod/src/__tests__/scheduler.test.ts` (append to existing suite — mirror existing patterns):

```typescript
it('registers fip-event-page-enricher when enabled', () => {
  const flags = { ...DEFAULT_FLAGS, enableFipEventPageEnricher: true };
  const entries = buildSchedule(flags, makeStubDeps());
  const names = entries.map((e) => e.name);
  expect(names).toContain('fip-event-page-enricher');
});
```

(If `DEFAULT_FLAGS` and `buildSchedule` aren't named exactly that — check the file with `grep -nE "DEFAULT_FLAGS|buildSchedule" padelgod/src/scheduler.ts` and use the actual names.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/scheduler.test.ts`
Expected: FAIL with "fip-event-page-enricher" not found.

- [ ] **Step 4: Add the registration to scheduler**

In `padelgod/src/scheduler.ts`:

1. Add the import near the other worker imports:
```typescript
import { runFipEventPageEnricher } from './workers/fip-event-page-enricher.js';
```

2. Extend the feature-flag interface (find the `enableTournamentDiscovery` line):
```typescript
enableFipEventPageEnricher: boolean;
```

3. Add to the worker name union (find the `'widget-code-lookup'` line):
```typescript
| 'fip-event-page-enricher'
```

4. Add to the worker-name array (find the `'widget-code-lookup',` line):
```typescript
'fip-event-page-enricher',
```

5. Add the runner case in `getWorkerRunner` (find `case 'widget-code-lookup':`):
```typescript
case 'fip-event-page-enricher': return (deps) => runFipEventPageEnricher(deps);
```

6. Add the schedule entry — paste below the existing `tournament-discovery` block in `buildSchedule`:
```typescript
if (flags.enableFipEventPageEnricher) {
  entries.push({
    name: 'fip-event-page-enricher',
    // hourly at :12 — runs after tournament-discovery (:00) so it sees
    // freshly-discovered rows in the same cycle.
    cron: '12 * * * *',
    run: getWorkerRunner('fip-event-page-enricher')!,
  });
}
```

7. Default the flag to true in `DEFAULT_FLAGS` (find the existing `enableTournamentDiscovery: true` and add adjacent):
```typescript
enableFipEventPageEnricher: true,
```

- [ ] **Step 5: Run scheduler test, verify pass**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run src/__tests__/scheduler.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Run full padelgod suite**

Run: `cd /Users/GuDenes/Projects/padel-live-scores/padelgod && npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add padelgod/src/scheduler.ts padelgod/src/__tests__/scheduler.test.ts
git commit -m "feat(padelgod): schedule fip-event-page-enricher hourly at :12"
```

---

### Task 10: Disable the Vercel `fip-tournaments` cron

**Files:**
- Modify: `vercel.json`
- Modify: `src/app/api/cron/fip-tournaments/route.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find and remove the schedule entry**

Run: `grep -n "fip-tournaments" /Users/GuDenes/Projects/padel-live-scores/vercel.json`

Note the line numbers, then edit the `crons` array entry to remove the `fip-tournaments` schedule. Keep `fip-scores` and `oop-monitor` (those handle separate concerns).

If the file has:
```json
{ "path": "/api/cron/fip-tournaments", "schedule": "0 */12 * * *" },
```
remove that one line.

- [ ] **Step 2: Replace the route file with a 410 Gone stub**

Replace `src/app/api/cron/fip-tournaments/route.ts` entirely with:

```typescript
// src/app/api/cron/fip-tournaments/route.ts
//
// **RETIRED 2026-04-28** — FIP tournament discovery + event-page
// enrichment moved to padelgod's `fip-event-page-enricher` worker
// (Railway service). See:
//   - padelgod/src/workers/fip-event-page-enricher.ts
//   - padelgod/src/workers/tournament-discovery.ts
//
// This route stays in place returning HTTP 410 Gone so anything still
// pinging the URL (Vercel scheduler residue, external monitors) gets a
// clear "moved to padelgod" signal instead of a 404.

export async function GET(): Promise<Response> {
  return Response.json(
    {
      error: 'gone',
      moved_to: 'padelgod fip-event-page-enricher worker',
      since: '2026-04-28',
    },
    { status: 410 },
  );
}
```

- [ ] **Step 3: Update CLAUDE.md to reflect single-scraper ownership**

Find the section in `CLAUDE.md` that lists scheduled jobs (search for "vercel.json" or "fip-tournaments"). Replace the `fip-tournaments` row with a sentence noting it has been retired and the work moved to padelgod. Suggested wording (paste into the place where the Vercel cron list lives):

```markdown
> **Retired 2026-04-28:** `/api/cron/fip-tournaments`. Discovery + event-page
> enrichment now run as padelgod workers (`tournament-discovery` and
> `fip-event-page-enricher`). The Vercel route stays as a 410 Gone stub.
```

- [ ] **Step 4: Verify no other Vercel files import the deleted route**

Run: `grep -rn "fip-tournaments" /Users/GuDenes/Projects/padel-live-scores/src 2>/dev/null | grep -v "fip-scores\|fip-tournaments/route.ts"`
Expected: no other references (or only doc comments).

- [ ] **Step 5: Build the Next.js app to confirm nothing breaks**

Run: `cd /Users/GuDenes/Projects/padel-live-scores && npx tsc --noEmit -p . 2>&1 | grep -E "error TS" | head -10`
Expected: no errors related to the change.

- [ ] **Step 6: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add vercel.json \
        src/app/api/cron/fip-tournaments/route.ts \
        CLAUDE.md
git commit -m "chore: retire Vercel fip-tournaments cron — moved to padelgod

Tournament discovery and event-page enrichment now run as padelgod
workers on Railway (tournament-discovery + fip-event-page-enricher).
The Vercel route stays as a 410 Gone stub so external monitors see
a clean 'moved' signal instead of a 404.

Single-source-of-truth for FIP scraping. Closes the dual-writer
race condition that caused level-null Premier rows to disappear
from the public app."
```

---

### Task 11: Verify parity in production

**Files:** None (operational verification).

- [ ] **Step 1: Push the branch and merge through PR**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git push -u origin <branch-name>
# Open a PR titled "Consolidate FIP scraping to padelgod"
# Get review, merge into main
```

- [ ] **Step 2: Wait for Vercel + Railway to deploy**

- Vercel deploys automatically on merge — confirm via dashboard.
- Railway redeploys padelgod on merge — confirm via Railway dashboard.

- [ ] **Step 3: Spot-check a fresh tournament**

Pick a tournament whose page exists on padelfip.com but isn't yet enriched in our DB (e.g. any FIP Beyond / Promises event with `matchscorer_url IS NULL`).

Wait for the next `:12` tick after deploy, then query:

```sql
SELECT id, name, matchscorer_url, venue, registration_status, prize_money_fip,
       prize_breakdown, last_updated_by, updated_at
FROM public.tournaments
WHERE id = '<the-test-tournament-id>';
```

Expected: `last_updated_by = 'padelgod'`, `matchscorer_url` non-null, `venue`/`registration_status` populated where the FIP page exposes them.

- [ ] **Step 4: Confirm the level-null bug is fixed**

```sql
-- Should return 0 rows (apart from any genuinely-unknown-tier ones)
SELECT id, name, level, source, padelapi_id, fip_id, slug
FROM public.tournaments
WHERE level IS NULL
  AND starts_at >= NOW()
  AND (source = 'fip' OR fip_id IS NOT NULL);
```

After one full cycle of padelgod's `tournament-discovery`, Premier rows like Asuncion P2 2026 should have `level = 'p2'` again automatically.

- [ ] **Step 5: Confirm no new dual-writer regression**

Quick audit: does `padelgod_active_tournaments_for_static_workers()` still return the right tournaments? Are OOP / results snapshots still flowing for the tournaments we already had working?

```sql
SELECT COUNT(*) AS active_tournaments
FROM padelgod_active_tournaments_for_static_workers();

-- Snapshot freshness check — should be < 1 hour for live tournaments
SELECT t.name, MAX(s.captured_at) AS last_snapshot
FROM public.tournaments t
JOIN padelgod.oop_snapshots s ON s.tournament_id = t.id
WHERE t.starts_at <= NOW() AND COALESCE(t.ends_at, NOW()) >= NOW()
GROUP BY t.name
ORDER BY last_snapshot DESC
LIMIT 10;
```

Expected: counts roughly match the pre-deploy baseline; snapshots remain fresh for live tournaments.

---

## Self-Review Checklist

After implementation, verify against the original spec (the user's request: "consolidate scraping to padelgod, principle is keep it simple, padelgod is the canonical scraper"):

- ✅ Single scraper for FIP tournament discovery + enrichment? Padelgod owns both passes after Task 10.
- ✅ The level-null Premier bug is fixed? Task 6's gap-fill writes Premier-tier level when existing is null.
- ✅ The alphanumeric eventID + oopbyday widget support carried over from this morning's work? Task 3's parser keeps both.
- ✅ The prize-money sign-up-fee leak prevented? Task 4's `parseDrawSizes` test asserts the no-fallback behaviour.
- ✅ Vercel admin endpoints (`backfill-fip-overview`, `link-premier`) keep working through the migration? Yes — they import from `src/lib/fip-scraper.ts` which stays unchanged.
- ✅ Tests cover all new code paths? Each task is TDD: failing test → impl → pass → commit.

---

## Out-of-Scope Follow-ups

Documented for future plans, NOT in this PR:

1. **Cleanup `src/lib/fip-scraper.ts` exports** once the Vercel admin endpoints have a path off them (~50 LOC of dead code at that point).
2. **Migrate `widget-code-lookup`** to read `public.tournaments.matchscorer_url` first → bypass Crionet search for tournaments where the FIP page already exposes the code. Saves ~12 attempts × hourly retries on stuck tournaments.
3. **Migrate `/api/cron/fip-scores`** (bracket scraper) to padelgod, completing the FIP pipeline consolidation.
4. **Migrate the ops endpoints** (`seed-entry-list`, `seed-draw`, `parse-entry-list`, `schedule-review`) to call padelgod RPCs — last step in retiring `src/lib/fip-scraper.ts` entirely.
