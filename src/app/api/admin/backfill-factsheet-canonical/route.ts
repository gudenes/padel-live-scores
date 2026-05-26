// src/app/api/admin/backfill-factsheet-canonical/route.ts
// One-time (idempotent) backfill: re-derive canonical columns from
// existing tournaments.factsheet_data rows that were processed BEFORE
// /api/cron/process-factsheets started writing canonical columns.
//
// Currently only backfills `prize_breakdown` (via mapFactsheetPrize).
// Other canonical columns (round_schedule, schedule_notes, venue_*, etc.)
// were always populated by Claude through the ENRICHABLE patch path —
// no backfill needed there.
//
// Auth: `Authorization: Bearer $CRON_SECRET`.
// Verb: GET (parity with other admin endpoints; this is read-mostly +
//   targeted writes, no body required).
// Query: ?tournament_id=<uuid> to backfill a single row (debugging).
//        Otherwise scans all tournaments with factsheet_data IS NOT NULL.
// Safety: each write is gated by `shouldOverwrite()` so we never clobber
//   'manual' or any future higher-priority source.
//
// Output:
//   { scanned, written, skipped: [{ tournament, reason }], results: [...] }
//
// After deploy, hit it once:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://padel-nacho.vercel.app/api/admin/backfill-factsheet-canonical"

import { createClient } from '@supabase/supabase-js'
import { paginatedSelect } from '@/lib/db-paginate'
import { mapFactsheetPrize, type FactsheetPrizeRow } from '@/lib/factsheet-mappers'
import { shouldOverwrite, type SourceName } from '@/lib/source-priority'

export const runtime = 'nodejs'
export const maxDuration = 60

interface Row {
  id: string
  name: string | null
  factsheet_data: { prize_money?: FactsheetPrizeRow[] } | null
  prize_breakdown: { source?: string } | null
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )

  const url = new URL(request.url)
  const onlyId = url.searchParams.get('tournament_id')

  // Pull every tournament with factsheet_data populated. Paginated read
  // because the candidate set can grow past PostgREST's 10k cap once a
  // few hundred FIP events have been processed and we re-run the
  // backfill after schema tweaks.
  const rows = onlyId
    ? await (async () => {
        const { data, error } = await supabase
          .from('tournaments')
          .select('id, name, factsheet_data, prize_breakdown')
          .eq('id', onlyId)
          .not('factsheet_data', 'is', null)
          .limit(1)
        if (error) throw new Error(error.message)
        return (data ?? []) as unknown as Row[]
      })()
    : await paginatedSelect<Row>(
        (start, end) =>
          supabase
            .from('tournaments')
            .select('id, name, factsheet_data, prize_breakdown')
            .not('factsheet_data', 'is', null)
            .order('id', { ascending: true })
            .range(start, end),
        { what: 'backfill-factsheet-canonical tournaments read' },
      )

  let written = 0
  const skipped: Array<{ tournament: string; reason: string }> = []
  const results: Array<{ tournament: string; ok: boolean; prize_breakdown_before?: unknown; prize_breakdown_after?: unknown; reason?: string }> = []

  for (const row of rows) {
    const label = row.name ?? row.id
    const factsheetPrize = mapFactsheetPrize(row.factsheet_data?.prize_money)
    if (!factsheetPrize) {
      skipped.push({ tournament: label, reason: 'no main-draw prize_money rows in factsheet' })
      results.push({ tournament: label, ok: true, reason: 'skipped: no canonical rows' })
      continue
    }

    // Cast to SourceName for the priority guard. Unknown source strings
    // get treated as "unlisted" and the guard's conservative-overwrite
    // rule allows the write — same behavior as null/empty.
    const existingSource = (row.prize_breakdown?.source ?? null) as SourceName | null
    if (!shouldOverwrite('tournament.prize_breakdown', existingSource, 'factsheet_pdf')) {
      skipped.push({ tournament: label, reason: `existing source=${existingSource} outranks factsheet_pdf` })
      results.push({ tournament: label, ok: true, reason: `skipped: source-priority blocked (current=${existingSource})` })
      continue
    }

    const { error: updErr } = await supabase
      .from('tournaments')
      .update({ prize_breakdown: factsheetPrize })
      .eq('id', row.id)

    if (updErr) {
      results.push({ tournament: label, ok: false, reason: `update failed: ${updErr.message}` })
      continue
    }

    written++
    results.push({
      tournament: label,
      ok: true,
      prize_breakdown_before: row.prize_breakdown,
      prize_breakdown_after: factsheetPrize,
    })
  }

  return Response.json({
    scanned: rows.length,
    written,
    skipped,
    results,
  })
}
