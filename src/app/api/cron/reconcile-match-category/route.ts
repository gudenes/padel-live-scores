// src/app/api/cron/reconcile-match-category/route.ts
//
// Repairs `matches.category` when the Crionet order-of-play page mislabels a
// bracket's gender. See src/lib/match-category-reconcile.ts for the full
// story — short version: multi-draw Games/championship events use draw codes
// whose letters are not gender (MA/MB/WA), the OOP header is wrong at the
// source, and mislabelled matches then render confidently under the wrong
// tab on the tournament page.
//
// Hourly is the right cadence: brackets gain rounds over the course of an
// event (QF/SF/F land days after R32), and each new round is inserted by
// padelgod carrying the same bad label, so a one-shot repair would drift
// back. An hour of wrongness on a not-yet-played round is acceptable; the
// job is cheap (two queries) and idempotent — a converged bracket produces
// zero findings and zero writes.
//
// `?dry=true` reports findings without writing, for operator spot-checks.

import { NextRequest, NextResponse } from 'next/server'
import { createPool } from '@/lib/pg'
import { logOpsEvent } from '@/lib/ops-logger'
import {
  findMiscategorised,
  applyFinding,
  MIN_VOTES,
  MAJORITY,
} from '@/lib/match-category-reconcile'

// Matches the window the tournament page actually surfaces. Older events are
// archive: a wrong label there is not worth re-scanning every hour, and a
// human can always run this with a wider window by hand.
const LOOKBACK_DAYS = 45

export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Auth: same Bearer pattern the other crons use.
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry') === 'true'

  try {
    const meta = await logOpsEvent('cron:reconcile-match-category', async () => {
      const pool = createPool()
      try {
        const findings = await findMiscategorised(pool, LOOKBACK_DAYS)

        let matchesUpdated = 0
        if (!dryRun) {
          for (const f of findings) {
            matchesUpdated += await applyFinding(pool, f)
          }
        }

        return {
          dryRun,
          lookbackDays: LOOKBACK_DAYS,
          minVotes: MIN_VOTES,
          majority: MAJORITY,
          bracketsFlagged: findings.length,
          matchesUpdated,
          // Small by construction — a run that flags more than a couple of
          // brackets is itself the signal worth reading in ops_events.
          findings,
        }
      } finally {
        await pool.end()
      }
    })

    return NextResponse.json({ ok: true, ...meta })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
