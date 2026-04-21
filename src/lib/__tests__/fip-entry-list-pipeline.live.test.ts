// Live end-to-end: runs the real pipeline against padelfip.com + Supabase.
// Run with:
//   LIVE=1 npx vitest run src/lib/__tests__/fip-entry-list-pipeline.live.test.ts
//
// This test is READ-ONLY — it exercises the pipeline producing
// PipelineSnapshotRow[] in memory. No DB writes happen here; the route
// handler (next task) owns the write side.

import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '../player-resolver'
import { runFipEntryListPipeline } from '../fip-entry-list-pipeline'

const describeLive = process.env.LIVE ? describe : describe.skip

describeLive('fip-entry-list-pipeline — live Ijuí', () => {
  it('runs end-to-end against real Ijuí PDFs and resolves most players', async () => {
    // Structural smoke test: exercises the full pipeline (event page → ajax →
    // PDFs → parse → resolve) against the real padelfip.com site. The 100%
    // resolution ceiling is reproducibly hittable but FIP search sporadically
    // rate-limits bursty calls — so the test checks for a high resolution
    // rate rather than an exact 0-unresolved. In production, unresolved rows
    // simply fail-soft: they end up with `fip_id=null` and the static
    // reconciler skips them until a future run fills them in.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
      { auth: { persistSession: false } }
    )
    const resolver = new PlayerResolver(supabase)

    const result = await runFipEntryListPipeline(
      {
        tournamentId: 'de01a65b-5cc6-4ca6-a940-57977686eae1',
        fipId: 'fip-bronze-ijui-2026',
      },
      { resolver }
    )

    console.log('Pipeline stats:', result.stats)
    console.log('Unresolved count:', result.unresolved.length)
    console.log('newPlayers count:', result.newPlayers.length)

    // Structural checks that must always hold
    expect(result.stats.pdfsDownloaded).toBe(2)
    expect(result.stats.teamsParsed).toBe(27 + 16) // parser produces 86 player slots
    const totalSlots = result.rows.length + result.unresolved.length
    expect(totalSlots).toBe(86)

    // Quality check: expect strong coverage (≥ 80%) from DB + FIP search combined.
    // A hard 100% assert is too flaky because FIP's public search endpoint
    // throttles aggressive bursts.
    expect(result.rows.length).toBeGreaterThanOrEqual(Math.ceil(86 * 0.8))

    // Every successfully-resolved row must carry a real fip_id of the canonical shape.
    for (const row of result.rows) {
      expect(row.fip_id).toMatch(/^fip-P\d+$/)
    }

    // Every FIP-search-resolved player must carry the full payload needed for
    // upsert (2-letter ISO country, profile URL, rank/points, category).
    for (const np of result.newPlayers) {
      expect(np.fipId).toMatch(/^fip-P\d+$/)
      expect(['men', 'women']).toContain(np.category)
      expect(np.country).toMatch(/^[A-Z]{2}$/)
      expect(np.profileUrl).toMatch(/^https?:\/\//)
    }
  }, 180_000)
})
