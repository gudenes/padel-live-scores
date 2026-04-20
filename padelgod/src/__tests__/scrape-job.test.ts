import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScrapeJob } from '../lib/scrape-job.js';
import type { ScrapeJobType } from '../lib/db-types.js';

function fakeSupabase() {
  const inserted: any[] = [];
  const updated: any[] = [];
  const payloads: any[] = [];
  return {
    inserted, updated, payloads,
    schema: (s: string) => ({
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
      }),
    }),
  };
}

describe('runScrapeJob', () => {
  let supabase: ReturnType<typeof fakeSupabase>;

  beforeEach(() => {
    supabase = fakeSupabase();
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
});
