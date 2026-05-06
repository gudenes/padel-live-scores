import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the PDF wrapper so we can feed deterministic canned text to the
// parser instead of constructing real PDF bytes. The parser's behaviour
// is covered separately in parsers/fip-entry-list-pdf tests.
vi.mock('../../lib/pdf-text.js', () => ({
  pdfToText: vi.fn(async () => ''),
}));

import { runEntryListFetcher } from '../../workers/entry-list-fetcher.js';
import { pdfToText } from '../../lib/pdf-text.js';

// ── Test helpers ──────────────────────────────────────────────────────────

interface InsertedSnapshot {
  scrape_job_id: string;
  tournament_id: string;
  category: 'men' | 'women';
  draw_type: 'main_draw' | 'qualifying';
  fip_id: string;
  name: string;
  country: string | null;
  seed: number | null;
  partner_fip_id: string | null;
  partner_name: string;
}

interface DbPlayerSeed {
  id: string;
  fip_id: string | null;
  name: string;
  normalized_name: string;
  country: string | null;
  ranking: number | null;
  category: 'men' | 'women';
}

function fakeSupabase(opts: {
  activeTournaments: Array<{
    tournament_id: string;
    tournament_name: string;
    slug: string | null;
    starts_at: string | null;
    ends_at: string | null;
  }>;
  dbPlayers: DbPlayerSeed[];
}) {
  const inserted: InsertedSnapshot[] = [];
  const scrapeJobUpdates: any[] = [];

  return {
    inserted,
    scrapeJobUpdates,
    schema: () => ({
      from: (t: string) => {
        if (t === 'entry_list_snapshots') {
          return {
            insert: (rows: any) => {
              const arr = Array.isArray(rows) ? rows : [rows];
              inserted.push(...arr);
              return Promise.resolve({ data: arr, error: null });
            },
          };
        }
        if (t === 'scrape_jobs') {
          return {
            insert: (row: any) => ({
              select: () => ({
                single: async () => ({ data: { id: 'job-uuid', ...row }, error: null }),
              }),
            }),
            update: (patch: any) => ({
              eq: () => {
                scrapeJobUpdates.push(patch);
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        }
        if (t === 'raw_payloads') {
          return {
            insert: (row: any) => ({
              select: () => ({
                single: async () => ({ data: { id: 'payload-uuid', ...row }, error: null }),
              }),
            }),
          };
        }
        return {
          insert: () => ({ data: null, error: { message: `unexpected table: ${t}` } }),
        };
      },
    }),
    from: (t: string) => {
      if (t === 'players') {
        return {
          select: () => ({
            eq: (_col: string, value: 'men' | 'women') => {
              const rows = opts.dbPlayers
                .filter((p) => p.category === value)
                .map((p) => ({
                  id: p.id,
                  fip_id: p.fip_id,
                  name: p.name,
                  normalized_name: p.normalized_name,
                  country: p.country,
                  ranking: p.ranking,
                  category: p.category,
                }));
              return Promise.resolve({ data: rows, error: null });
            },
          }),
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      };
    },
    rpc: vi.fn(async () => ({ data: opts.activeTournaments, error: null })),
  };
}

// FIP event-page HTML with the canonical nonce + post_id markers the
// extractNonceAndPostId regex expects.
const eventPageHtml = `
<html>
<head>
  <script>
    window.padelfip_ajax = {"ajax_url":"https://www.padelfip.com/wp-admin/admin-ajax.php","nonce":"abc123def4"};
  </script>
</head>
<body>
  <div data-post-id="987654" class="event-container">…</div>
</body>
</html>
`;

// admin-ajax response shape — wraps an HTML blob containing the pdfMap.
const ajaxJson = (menUrl: string, womenUrl: string) =>
  JSON.stringify({
    success: true,
    data: {
      html: `<div>some html</div><script>var pdfMap = {"M":{"":"${menUrl.replace(/\//g, '\\/')}"}, "W":{"":"${womenUrl.replace(/\//g, '\\/')}"}};</script>`,
    },
  });

// Synthetic PDF text that parseEntryListText knows how to chew on. Two
// teams in main draw + one team in qualifying. Players are pre-seeded in
// the DB so resolver hits without calling FIP search.
const menPdfText = `
FIP BRONZE TESTONIA
ENTRY LIST Hombres's
Last Update: 27/4/2026
Pos Ranking Player Country
1\t1 Arturo Coello ESP
800 points 2 Agustin Tapia ARG
800 points 1600
2\t10 Federico Chingotto ARG
500 points 11 Alejandro Galan ESP
500 points 1000
QUALIFICATIONS
Pos Ranking Player Country
1\t150 Q One Player ARG
50 points 151 Q Two Player ARG
50 points 100
`.trim();

beforeEach(() => {
  vi.mocked(pdfToText).mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('runEntryListFetcher (FIP PDF mode)', () => {
  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase({ activeTournaments: [], dbPlayers: [] });
    const httpClient = { get: vi.fn(), post: vi.fn() };

    const result = await runEntryListFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.tournamentsConsidered).toBe(0);
    expect(result.tournamentsProcessed).toBe(0);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('skips tournaments with no slug', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'tour-no-slug',
          tournament_name: 'Mystery',
          slug: null,
          starts_at: null,
          ends_at: null,
        },
      ],
      dbPlayers: [],
    });
    const httpClient = { get: vi.fn(), post: vi.fn() };

    const result = await runEntryListFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.tournamentsConsidered).toBe(1);
    expect(result.tournamentsProcessed).toBe(0);
    expect(result.tournamentsSkippedNoPdfs).toBe(1);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('discovers PDFs, parses them, and writes snapshots tagged with draw_type', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'tour-1',
          tournament_name: 'FIP Bronze Testonia',
          slug: 'fip-bronze-testonia-2026',
          starts_at: '2026-05-01T00:00:00Z',
          ends_at: '2026-05-08T00:00:00Z',
        },
      ],
      dbPlayers: [
        // Pre-seeded so the resolver hits DB without calling FIP search.
        { id: 'p1', fip_id: 'fip-P0001', name: 'Arturo Coello', normalized_name: 'arturo coello', country: 'ES', ranking: 1, category: 'men' },
        { id: 'p2', fip_id: 'fip-P0002', name: 'Agustin Tapia', normalized_name: 'agustin tapia', country: 'AR', ranking: 2, category: 'men' },
        { id: 'p3', fip_id: 'fip-P0010', name: 'Federico Chingotto', normalized_name: 'federico chingotto', country: 'AR', ranking: 10, category: 'men' },
        { id: 'p4', fip_id: 'fip-P0011', name: 'Alejandro Galan', normalized_name: 'alejandro galan', country: 'ES', ranking: 11, category: 'men' },
        { id: 'p5', fip_id: 'fip-P0150', name: 'Q One Player', normalized_name: 'q one player', country: 'AR', ranking: 150, category: 'men' },
        { id: 'p6', fip_id: 'fip-P0151', name: 'Q Two Player', normalized_name: 'q two player', country: 'AR', ranking: 151, category: 'men' },
      ],
    });

    // pdfToText returns the men's canned text on first call (men's PDF),
    // empty on subsequent calls — covers the women's PDF call (0 teams →
    // 0 snapshots) without needing a parallel test fixture.
    vi.mocked(pdfToText)
      .mockImplementationOnce(async () => menPdfText)
      .mockImplementation(async () => '');

    const httpClient = {
      // 1st call: GET event page
      // 2nd call: GET men PDF
      // 3rd call: GET women PDF
      get: vi
        .fn()
        .mockResolvedValueOnce({ data: eventPageHtml })
        .mockResolvedValue({ data: new ArrayBuffer(8) }),
      // 1st call: POST admin-ajax → JSON with PDF URLs
      post: vi.fn().mockResolvedValueOnce({
        data: ajaxJson(
          'https://www.padelfip.com/wp-content/uploads/men.pdf',
          'https://www.padelfip.com/wp-content/uploads/women.pdf'
        ),
      }),
    };

    const result = await runEntryListFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.tournamentsConsidered).toBe(1);
    expect(result.tournamentsProcessed).toBe(1);
    expect(result.tournamentsSkippedNoPdfs).toBe(0);

    // 3 teams parsed × 2 players each = 6 snapshot rows. All in men.
    expect(supabase.inserted).toHaveLength(6);
    expect(supabase.inserted.every((r) => r.category === 'men')).toBe(true);

    // First two teams are main draw, third is qualifying.
    const mainDraws = supabase.inserted.filter((r) => r.draw_type === 'main_draw');
    const qualifying = supabase.inserted.filter((r) => r.draw_type === 'qualifying');
    expect(mainDraws).toHaveLength(4); // 2 teams × 2 players
    expect(qualifying).toHaveLength(2); // 1 team × 2 players

    // Resolver hit DB on every player — verify a sample fip_id landed.
    expect(supabase.inserted[0].fip_id).toBe('fip-P0001');
    expect(supabase.inserted[0].partner_fip_id).toBe('fip-P0002');
    expect(supabase.inserted[0].seed).toBe(1); // team position recorded once on player1
    expect(supabase.inserted[1].seed).toBeNull(); // partner row carries no seed

    // Qualifying row carries the right draw_type tag.
    expect(qualifying[0].fip_id).toBe('fip-P0150');
    expect(qualifying[0].seed).toBe(1); // qualifying positions restart at 1
  });

  it('stores the resolvable partner when only one player on the team can be resolved', async () => {
    // Regression: pre-fix behaviour skipped the whole team if either player
    // failed to resolve. This dropped legitimate fip-IDed players (e.g.
    // Giulia Dal Pozzo paired with a not-yet-FIP-indexed Nuria Rodriguez
    // Camacho) from the snapshot, breaking downstream draw resolution for
    // every match that referenced them. Now: at least one resolved player
    // means at least one row written, and the unresolved partner shows up
    // as a raw `partner_name` with `partner_fip_id: null`.
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'tour-1',
          tournament_name: 'FIP Bronze Testonia',
          slug: 'fip-bronze-testonia-2026',
          starts_at: '2026-05-01T00:00:00Z',
          ends_at: '2026-05-08T00:00:00Z',
        },
      ],
      dbPlayers: [
        // Resolvable: in DB with fip_id.
        { id: 'p1', fip_id: 'fip-P0001', name: 'Arturo Coello', normalized_name: 'arturo coello', country: 'ES', ranking: 1, category: 'men' },
        { id: 'p3', fip_id: 'fip-P0010', name: 'Federico Chingotto', normalized_name: 'federico chingotto', country: 'AR', ranking: 10, category: 'men' },
        { id: 'p4', fip_id: 'fip-P0011', name: 'Alejandro Galan', normalized_name: 'alejandro galan', country: 'ES', ranking: 11, category: 'men' },
        { id: 'p5', fip_id: 'fip-P0150', name: 'Q One Player', normalized_name: 'q one player', country: 'AR', ranking: 150, category: 'men' },
        { id: 'p6', fip_id: 'fip-P0151', name: 'Q Two Player', normalized_name: 'q two player', country: 'AR', ranking: 151, category: 'men' },
        // Note: Agustin Tapia intentionally NOT seeded so r2 fails to
        // resolve for team 1. FIP search fallback below also stubbed
        // empty so searchFipPlayer returns null cleanly.
      ],
    });

    vi.mocked(pdfToText)
      .mockImplementationOnce(async () => menPdfText)
      .mockImplementation(async () => '');

    const httpClient = {
      // Event-page GET, then 2 PDF GETs, then any number of FIP search
      // GETs (all returning empty arrays so Tapia stays unresolved).
      get: vi.fn().mockImplementation((url: string) => {
        if (url.includes('/events/')) return Promise.resolve({ data: eventPageHtml });
        if (url.endsWith('.pdf') || url.includes('/uploads/')) return Promise.resolve({ data: new ArrayBuffer(8) });
        // Default — FIP player search returning no matches
        return Promise.resolve({ data: [] });
      }),
      post: vi.fn().mockResolvedValueOnce({
        data: ajaxJson(
          'https://www.padelfip.com/wp-content/uploads/men.pdf',
          'https://www.padelfip.com/wp-content/uploads/women.pdf'
        ),
      }),
    };

    const result = await runEntryListFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.tournamentsProcessed).toBe(1);

    // Team 1 (Coello + Tapia): Coello resolves, Tapia doesn't → 1 row.
    // Team 2 (Chingotto + Galan): both resolve → 2 rows.
    // Q team (Q One + Q Two): both resolve → 2 rows.
    // Total = 5 rows (was 4 under old behaviour: team 1 entirely skipped).
    expect(supabase.inserted).toHaveLength(5);

    // Coello's row exists with seed and a partner_name (raw) but null partner_fip_id.
    const coello = supabase.inserted.find((r) => r.fip_id === 'fip-P0001');
    expect(coello).toBeDefined();
    expect(coello!.seed).toBe(1);
    expect(coello!.partner_fip_id).toBeNull();
    expect(coello!.partner_name).toBe('Agustin Tapia');

    // No row for Tapia (he didn't resolve).
    expect(supabase.inserted.some((r) => r.name === 'Agustin Tapia')).toBe(false);

    // Team 2 still writes both rows with seeds + linked partner ids.
    const chingotto = supabase.inserted.find((r) => r.fip_id === 'fip-P0010');
    expect(chingotto!.partner_fip_id).toBe('fip-P0011');
  });

  it('soft-skips a failing tournament without taking the rest of the run down', async () => {
    const supabase = fakeSupabase({
      activeTournaments: [
        {
          tournament_id: 'tour-bad',
          tournament_name: 'Broken',
          slug: 'broken-2026',
          starts_at: null,
          ends_at: null,
        },
        {
          tournament_id: 'tour-good',
          tournament_name: 'OK',
          slug: 'ok-2026',
          starts_at: null,
          ends_at: null,
        },
      ],
      dbPlayers: [],
    });

    // First tournament: GET throws. Second tournament: returns event page
    // with no PDF map (admin-ajax body returns -1) → skipped as no-pdfs.
    const httpClient = {
      get: vi
        .fn()
        .mockRejectedValueOnce(new Error('upstream 500'))
        .mockResolvedValueOnce({ data: eventPageHtml }),
      post: vi.fn().mockResolvedValueOnce({ data: '-1' }),
    };

    // Suppress expected error log
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runEntryListFetcher({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    errSpy.mockRestore();

    // Two tournaments considered; first errored (skipped via catch);
    // second yielded no PDFs → tournamentsSkippedNoPdfs = 1.
    expect(result.tournamentsConsidered).toBe(2);
    expect(result.tournamentsProcessed).toBe(0);
    expect(result.tournamentsSkippedNoPdfs).toBe(1);
  });
});
