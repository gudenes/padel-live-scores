import { describe, it, expect, vi } from 'vitest'
import { persistPipelineResult } from '../fip-entry-list-persist'
import type { PipelineResult } from '../fip-entry-list-pipeline'

// Minimal mock of the Supabase client shape we exercise. Each table gets its
// own chainable mock so assertions can inspect what was written.
function makeMockSupabase(opts: {
  // Fixed responses for supabase.schema('padelgod').from('scrape_jobs').insert().select().single()
  scrapeJobInsertId?: string
  scrapeJobInsertError?: { message: string } | null
  existingFipIds?: string[]
  playersInsertError?: { message: string } | null
  snapshotsInsertError?: { message: string } | null
  scrapeJobUpdateError?: { message: string } | null
}) {
  const calls = {
    scrapeJobInserts: [] as any[],
    scrapeJobUpdates: [] as any[],
    playersSelected: [] as any[],
    playersInserts: [] as any[],
    snapshotsInserts: [] as any[],
  }

  const publicFrom = (table: string) => {
    if (table === 'players') {
      return {
        select: (cols: string) => ({
          in: (col: string, values: string[]) => {
            calls.playersSelected.push({ cols, col, values })
            const existing = (opts.existingFipIds ?? []).map(fid => ({ fip_id: fid }))
            return Promise.resolve({ data: existing, error: null })
          },
        }),
        insert: (rows: any[]) => {
          calls.playersInserts.push(rows)
          return Promise.resolve({ data: null, error: opts.playersInsertError ?? null })
        },
      }
    }
    throw new Error(`Unexpected public table: ${table}`)
  }

  const padelgodFrom = (table: string) => {
    if (table === 'scrape_jobs') {
      return {
        insert: (row: any) => {
          calls.scrapeJobInserts.push(row)
          return {
            select: (_cols: string) => ({
              single: () =>
                Promise.resolve({
                  data: opts.scrapeJobInsertError
                    ? null
                    : { id: opts.scrapeJobInsertId ?? 'mock-job-uuid' },
                  error: opts.scrapeJobInsertError ?? null,
                }),
            }),
          }
        },
        update: (patch: any) => ({
          eq: (col: string, val: string) => {
            calls.scrapeJobUpdates.push({ patch, col, val })
            return Promise.resolve({ data: null, error: opts.scrapeJobUpdateError ?? null })
          },
        }),
      }
    }
    if (table === 'entry_list_snapshots') {
      return {
        insert: (rows: any[]) => {
          calls.snapshotsInserts.push(rows)
          return Promise.resolve({ data: null, error: opts.snapshotsInsertError ?? null })
        },
      }
    }
    throw new Error(`Unexpected padelgod table: ${table}`)
  }

  const client = {
    from: publicFrom,
    schema: (name: string) => {
      if (name !== 'padelgod') throw new Error(`Unexpected schema: ${name}`)
      return { from: padelgodFrom }
    },
  }

  return { client, calls }
}

function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    tournamentId: 'de01a65b-5cc6-4ca6-a940-57977686eae1',
    fipId: 'fip-bronze-ijui-2026',
    pdfUrls: { men: 'https://example.com/m.pdf', women: 'https://example.com/w.pdf' },
    rows: [
      { category: 'men', fip_id: 'fip-P000005', name: 'Alpha One', country: 'AR',
        seed: 1, partner_fip_id: 'fip-P000006', partner_name: 'Beta Two' },
      { category: 'men', fip_id: 'fip-P000006', name: 'Beta Two', country: 'AR',
        seed: null, partner_fip_id: 'fip-P000005', partner_name: 'Alpha One' },
    ],
    unresolved: [],
    newPlayers: [
      { fipId: 'fip-P100312', category: 'men', name: 'Cleo Carvalho', country: 'BR',
        rank: 1736, points: 5, profileUrl: 'https://www.padelfip.com/player/cleo-carvalho/' },
      { fipId: 'fip-P208174', category: 'women', name: 'Fatima Yuri Kudo Ykkatai', country: 'PY',
        rank: 809, points: 10, profileUrl: 'https://www.padelfip.com/player/fatima-yuri-kudo-ykkatai/' },
    ],
    stats: { dbMatches: 58, fipSearchMatches: 28, unresolved: 0, teamsParsed: 43, pdfsDownloaded: 2 },
    ...overrides,
  }
}

describe('persistPipelineResult', () => {
  it('creates a scrape_job, upserts new players, inserts snapshots, and marks the job success', async () => {
    const { client, calls } = makeMockSupabase({
      scrapeJobInsertId: 'job-uuid-123',
      existingFipIds: [], // neither fip-search player exists yet
    })

    const out = await persistPipelineResult(client as any, makePipelineResult())

    expect(out).toEqual({
      scrapeJobId: 'job-uuid-123',
      playersInserted: 2,
      snapshotsInserted: 2,
    })

    // scrape_job created first with status='running' and proper type
    expect(calls.scrapeJobInserts).toHaveLength(1)
    expect(calls.scrapeJobInserts[0]).toMatchObject({
      job_type: 'fip_pdf_entry_list',
      tournament_id: 'de01a65b-5cc6-4ca6-a940-57977686eae1',
      status: 'running',
    })

    // Players were queried for existing fip_ids, then the missing ones were inserted
    expect(calls.playersSelected).toHaveLength(1)
    expect(calls.playersSelected[0].values).toEqual(['fip-P100312', 'fip-P208174'])
    expect(calls.playersInserts).toHaveLength(1)
    expect(calls.playersInserts[0]).toHaveLength(2)
    expect(calls.playersInserts[0][0]).toMatchObject({
      fip_id: 'fip-P100312',
      name: 'Cleo Carvalho',
      category: 'men',
      country: 'BR',
      ranking: 1736,
      // NOTE: `source` was removed from the insert payload on 2026-04-23 —
      // `public.players` has no `source` column (provenance lives in
      // `last_updated_by`, which is set to 'padelgod' by the persist layer).
      last_updated_by: 'padelgod',
    })

    // Snapshots inserted with scrape_job_id + tournament_id on every row
    expect(calls.snapshotsInserts).toHaveLength(1)
    expect(calls.snapshotsInserts[0]).toHaveLength(2)
    expect(calls.snapshotsInserts[0][0]).toMatchObject({
      scrape_job_id: 'job-uuid-123',
      tournament_id: 'de01a65b-5cc6-4ca6-a940-57977686eae1',
      fip_id: 'fip-P000005',
      category: 'men',
    })

    // scrape_job marked success at the end
    expect(calls.scrapeJobUpdates).toHaveLength(1)
    expect(calls.scrapeJobUpdates[0].patch.status).toBe('success')
    expect(calls.scrapeJobUpdates[0].patch.completed_at).toBeDefined()
    expect(calls.scrapeJobUpdates[0].patch.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('skips inserting players that already exist in public.players (by fip_id)', async () => {
    const { client, calls } = makeMockSupabase({
      scrapeJobInsertId: 'job2',
      existingFipIds: ['fip-P100312'], // one of the two newPlayers is already there
    })
    await persistPipelineResult(client as any, makePipelineResult())
    // Only the NEW player is inserted
    expect(calls.playersInserts[0]).toHaveLength(1)
    expect(calls.playersInserts[0][0].fip_id).toBe('fip-P208174')
  })

  it('does not insert players when every newPlayer already exists', async () => {
    const { client, calls } = makeMockSupabase({
      scrapeJobInsertId: 'job3',
      existingFipIds: ['fip-P100312', 'fip-P208174'],
    })
    const out = await persistPipelineResult(client as any, makePipelineResult())
    // No insert call made
    expect(calls.playersInserts).toHaveLength(0)
    expect(out.playersInserted).toBe(0)
  })

  it('marks the scrape_job failed when snapshot insert errors', async () => {
    const { client, calls } = makeMockSupabase({
      scrapeJobInsertId: 'job4',
      snapshotsInsertError: { message: 'simulated failure' },
    })
    await expect(
      persistPipelineResult(client as any, makePipelineResult())
    ).rejects.toThrow(/simulated failure/)
    // scrape_job should have been updated to failed
    expect(calls.scrapeJobUpdates).toHaveLength(1)
    expect(calls.scrapeJobUpdates[0].patch.status).toBe('failed')
    expect(calls.scrapeJobUpdates[0].patch.error_message).toMatch(/simulated failure/)
  })

  it('throws directly when scrape_job insert itself fails (nothing written downstream)', async () => {
    const { client, calls } = makeMockSupabase({
      scrapeJobInsertError: { message: 'cannot create job' },
    })
    await expect(
      persistPipelineResult(client as any, makePipelineResult())
    ).rejects.toThrow(/cannot create job/)
    expect(calls.playersInserts).toHaveLength(0)
    expect(calls.snapshotsInserts).toHaveLength(0)
    expect(calls.scrapeJobUpdates).toHaveLength(0)
  })

  it('handles an empty result (no rows, no new players) — still creates + closes the scrape_job', async () => {
    const { client, calls } = makeMockSupabase({ scrapeJobInsertId: 'job5' })
    const out = await persistPipelineResult(
      client as any,
      makePipelineResult({ rows: [], newPlayers: [] })
    )
    expect(out.playersInserted).toBe(0)
    expect(out.snapshotsInserted).toBe(0)
    expect(calls.playersInserts).toHaveLength(0)
    expect(calls.snapshotsInserts).toHaveLength(0)
    expect(calls.scrapeJobUpdates[0].patch.status).toBe('success')
  })
})
