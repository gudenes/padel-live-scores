import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runScrapeJob } from '../lib/scrape-job.js';
import type { ScrapeJobType } from '../lib/db-types.js';

function fakeSupabase(opts: { latestRow?: any } = {}) {
  const inserted: any[] = [];
  const updated: any[] = [];
  const payloads: any[] = [];
  const upserts: any[] = [];
  return {
    inserted, updated, payloads, upserts,
    schema: (_s: string) => ({
      from: (table: string) => ({
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              if (table === 'scrape_jobs') {
                inserted.push({ table, row });
                return { data: { id: 'job-uuid', ...row }, error: null };
              }
              if (table === 'raw_payloads') {
                inserted.push({ table, row });
                payloads.push({ table, row });
                return { data: { id: 'payload-uuid', ...row }, error: null };
              }
              return { data: null, error: { message: 'unexpected' } };
            },
          }),
        }),
        update: (changes: any) => ({
          eq: (col: string, val: any) => {
            updated.push({ table, changes, where: { [col]: val } });
            return { data: null, error: null };
          },
        }),
        upsert: (row: any, _o?: any) => {
          upserts.push({ table, row });
          return { error: null };
        },
        select: (_cols?: string) => {
          const chain: any = {
            eq: () => chain,
            maybeSingle: async () => ({ data: opts.latestRow ?? null, error: null }),
          };
          return chain;
        },
      }),
    }),
  };
}

describe('runScrapeJob', () => {
  let supabase: ReturnType<typeof fakeSupabase>;

  beforeEach(() => {
    supabase = fakeSupabase();
  });

  const baseOpts = {
    jobType: 'oop' as ScrapeJobType,
    tournamentId: 'tour-uuid',
    targetUrl: 'https://example.com/oop',
    parserVersion: 'test-1.0.0',
    captureBody: true,
  };

  afterEach(() => {
    delete process.env.RAW_PAYLOAD_DEDUP_ENABLED;
    delete process.env.RAW_PAYLOAD_HEARTBEAT_DAYS;
  });

  it('records a successful job (with raw payload)', async () => {
    const result = await runScrapeJob(
      supabase as any,
      {
        jobType: 'discover' as ScrapeJobType,
        tournamentId: null,
        targetUrl: 'https://example.com/api',
        parserVersion: 'test-1.0.0',
        captureBody: true,
      },
      async () => ({ body: '<html>ok</html>', contentHash: 'sha256:abc' })
    );

    expect(result.status).toBe('success');
    expect(result.scrapeJobId).toBe('job-uuid');
    expect(supabase.inserted).toHaveLength(2); // scrape_jobs + raw_payloads
    expect(supabase.updated).toHaveLength(1);  // status update
    expect(supabase.updated[0].changes.status).toBe('success');
  });

  it('records a failed job and rethrows the error', async () => {
    await expect(
      runScrapeJob(
        supabase as any,
        {
          jobType: 'oop' as ScrapeJobType,
          tournamentId: 'tour-uuid',
          targetUrl: 'https://example.com/oop',
          parserVersion: 'test-1.0.0',
          captureBody: false,
        },
        async () => {
          throw new Error('upstream 500');
        }
      )
    ).rejects.toThrow(/upstream 500/);

    const update = supabase.updated[0];
    expect(update.changes.status).toBe('failed');
    expect(update.changes.error_message).toMatch(/upstream 500/);
  });

  it('skips raw_payloads insert when captureBody=false', async () => {
    await runScrapeJob(
      supabase as any,
      {
        jobType: 'rankings' as ScrapeJobType,
        tournamentId: null,
        targetUrl: 'https://x',
        parserVersion: 'v',
        captureBody: false,
      },
      async () => ({ body: 'ignored', contentHash: 'h' })
    );

    expect(supabase.payloads).toHaveLength(0);
  });

  it('first capture (no prior row) stores body and upserts latest', async () => {
    const sb = fakeSupabase({ latestRow: null });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(1);
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row.last_content_hash).toBe('h1');
  });

  it('skips storing when hash unchanged within heartbeat', async () => {
    const sb = fakeSupabase({
      latestRow: { last_content_hash: 'h1', last_stored_at: new Date().toISOString() },
    });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(0);
    expect(sb.upserts).toHaveLength(0);
  });

  it('stores when hash unchanged but heartbeat elapsed', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const sb = fakeSupabase({
      latestRow: { last_content_hash: 'h1', last_stored_at: eightDaysAgo },
    });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(1);
    expect(sb.upserts).toHaveLength(1);
  });

  it('stores when hash changed', async () => {
    const sb = fakeSupabase({
      latestRow: { last_content_hash: 'OLD', last_stored_at: new Date().toISOString() },
    });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'NEW' }));
    expect(sb.payloads).toHaveLength(1);
    expect(sb.upserts[0].row.last_content_hash).toBe('NEW');
  });

  it('fail-open: stores when latest lookup errors', async () => {
    const sb: any = fakeSupabase({ latestRow: null });
    const origSchema = sb.schema;
    sb.schema = (s: string) => {
      const real = origSchema(s);
      return {
        from: (t: string) => {
          const r = real.from(t);
          return {
            ...r,
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
          };
        },
      };
    };
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(1);
  });

  it('dedup disabled: always stores even when hash unchanged', async () => {
    process.env.RAW_PAYLOAD_DEDUP_ENABLED = 'false';
    const sb = fakeSupabase({
      latestRow: { last_content_hash: 'h1', last_stored_at: new Date().toISOString() },
    });
    await runScrapeJob(sb as any, baseOpts, async () => ({ body: 'X', contentHash: 'h1' }));
    expect(sb.payloads).toHaveLength(1);
  });
});
