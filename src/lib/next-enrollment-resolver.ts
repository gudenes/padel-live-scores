import { normalize } from '@/lib/player-resolver'

export interface EntrySnapshotRow {
  scrape_job_id: string
  tournament_id: string
  category: 'men' | 'women'
  draw_type: 'main_draw' | 'qualifying'
  fip_id: string | null
  name: string
  seed: number | null
  partner_name: string | null
  captured_at: string
}

export interface UpcomingTournament {
  id: string
  name: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
}

export interface PlayerIdentity {
  /** Raw FIP id from public.players, e.g. 'P000036' (no fip- prefix). */
  fipId: string | null
  /** public.players.normalized_name. */
  normalizedName: string | null
}

export interface NextEnrollment {
  tournamentId: string
  name: string | null
  level: string | null
  startsAt: string | null
  endsAt: string | null
  seed: number | null
  partnerName: string | null
  drawType: 'main_draw' | 'qualifying'
}

const stripFip = (s: string | null): string | null =>
  s == null ? null : s.replace(/^fip-/, '')

/**
 * Pick the soonest upcoming tournament the player is currently enrolled in.
 * Pure: caller supplies snapshot rows (already restricted to the upcoming
 * tournaments) and the tournament metadata. Honors withdrawals by keeping
 * only the latest scrape_job per (tournament_id, category).
 *
 * Assumption: a withdrawal is signalled by a later, NON-empty scrape that no
 * longer lists the player. A scrape that found an empty entry list inserts no
 * rows, so it leaves no trace here and cannot be detected from snapshots alone
 * — acceptable for this soft, non-authoritative affordance.
 */
export function resolveNextEnrollment(args: {
  player: PlayerIdentity
  snapshots: EntrySnapshotRow[]
  tournaments: UpcomingTournament[]
  now: Date
}): NextEnrollment | null {
  const { player, snapshots, tournaments, now } = args

  const tournById = new Map<string, UpcomingTournament>()
  for (const t of tournaments) {
    if (!t.ends_at || new Date(t.ends_at) > now) tournById.set(t.id, t)
  }
  if (tournById.size === 0) return null

  const latestJob = new Map<string, { jobId: string; capturedAt: string }>()
  for (const r of snapshots) {
    if (!tournById.has(r.tournament_id)) continue
    const key = `${r.tournament_id}::${r.category}`
    const cur = latestJob.get(key)
    if (!cur || r.captured_at > cur.capturedAt) {
      latestJob.set(key, { jobId: r.scrape_job_id, capturedAt: r.captured_at })
    }
  }
  const isLatest = (r: EntrySnapshotRow) =>
    latestJob.get(`${r.tournament_id}::${r.category}`)?.jobId === r.scrape_job_id

  const wantFip = stripFip(player.fipId)
  const wantName = player.normalizedName
  const matches = snapshots.filter((r) => {
    if (!isLatest(r)) return false
    if (wantFip && stripFip(r.fip_id) === wantFip) return true
    // Name fallback ONLY for players who themselves have no fip_id (amateurs /
    // unresolved). If the player has a known fip_id we require a fip match and
    // never fall through to name — otherwise a different person sharing a
    // normalized name (with a null-fip snapshot row) is a false positive.
    if (!wantFip && wantName && r.fip_id == null && normalize(r.name) === wantName) return true
    return false
  })
  if (matches.length === 0) return null

  const byTourn = new Map<string, EntrySnapshotRow[]>()
  for (const r of matches) {
    const arr = byTourn.get(r.tournament_id) ?? []
    arr.push(r)
    byTourn.set(r.tournament_id, arr)
  }

  const candidates: { t: UpcomingTournament; rows: EntrySnapshotRow[] }[] = []
  for (const [tid, rows] of byTourn) {
    const t = tournById.get(tid)
    if (t) candidates.push({ t, rows })
  }
  if (candidates.length === 0) return null

  const startsMs = (t: UpcomingTournament) =>
    t.starts_at ? new Date(t.starts_at).getTime() : Infinity

  // Prefer enrollments that haven't STARTED yet — the true "next appointment".
  // A tier-3 hit on an in-progress event (started, not yet ended) almost always
  // means the player is already eliminated there but still listed in the entry
  // list; a genuinely upcoming enrollment is the better answer. Fall back to
  // in-progress only when there is no future-starting enrollment.
  const future = candidates.filter((c) => startsMs(c.t) > now.getTime())
  const pool = future.length > 0 ? future : candidates
  const best = pool.reduce((acc, c) => (startsMs(c.t) < startsMs(acc.t) ? c : acc))

  const chosen = best.rows.find((r) => r.draw_type === 'main_draw') ?? best.rows[0]

  return {
    tournamentId: best.t.id,
    name: best.t.name,
    level: best.t.level,
    startsAt: best.t.starts_at,
    endsAt: best.t.ends_at,
    seed: chosen.seed,
    partnerName: chosen.partner_name,
    drawType: chosen.draw_type,
  }
}
