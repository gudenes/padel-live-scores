import type { SchedulerDeps } from '../scheduler.js';
import { CourtbitClient, normalizeCourtbitUrl, courtbitPlayerKey } from '../lib/courtbit-client.js';
import { courtbitToSnapshot, observedPointWinner } from '../lib/courtbit-adapter.js';
import { loadCourtbitContext, resolveCourtbitMatch, resolveCourtbitPlayer } from '../lib/courtbit-resolve.js';
import { notifyLiveTransition } from '../lib/notify.js';
import { paginatedSelect } from '../lib/db-paginate.js';

export interface CourtbitTarget { tournamentId: string; url: string; expectedName: string }
export interface CourtbitOpts { dryRun: boolean; targets?: CourtbitTarget[] }
export interface CourtbitResult {
  dryRun: boolean; tournaments: number; players: number; unresolvedPlayers: number;
  liveSeen: number; resolved: number; applied: number; skipped: number; errors: number;
  issues: Array<{ providerId: string; reason: string; candidates: string[] }>;
}
export async function discoverCourtbitTargets(deps: SchedulerDeps): Promise<CourtbitTarget[]> {
  const rows = await paginatedSelect<any>((a, b) => deps.supabase.from('entity_external_ids').select('entity_id,external_id,metadata')
    .eq('entity_type', 'tournament').eq('source', 'courtbit_live').order('id').range(a, b), { what: 'CourtBit tournaments' });
  if (!rows.length) return [];
  const { data, error } = await deps.supabase.from('tournaments').select('id,starts_at,ends_at').in('id', rows.map(r => r.entity_id));
  if (error) throw error;
  const now = Date.now();
  const active = new Set((data ?? []).filter(t => t.starts_at && t.ends_at &&
    Date.parse(t.starts_at) <= now + 86400000 && Date.parse(t.ends_at) + 86400000 >= now).map(t => t.id));
  return rows.filter(r => active.has(r.entity_id)).map(r => ({ tournamentId: r.entity_id, url: normalizeCourtbitUrl(r.external_id), expectedName: r.metadata?.expectedName ?? '' }));
}

/** Per-client process lock covers scheduled + admin invocation. Cross-process
 * concurrency is handled by the transactional writer's lock and expected state. */
export function createCourtbitRunner() {
  const client = new CourtbitClient();
  const running = new WeakSet<object>();
  const failures = new Map<string, { count: number; retryAt: number }>();
  return async (deps: SchedulerDeps, opts: CourtbitOpts): Promise<CourtbitResult> => {
    const result: CourtbitResult = { dryRun: opts.dryRun, tournaments: 0, players: 0, unresolvedPlayers: 0, liveSeen: 0, resolved: 0, applied: 0, skipped: 0, errors: 0, issues: [] };
    if (running.has(deps.supabase)) { result.skipped++; return result; }
    running.add(deps.supabase);
    try {
      const targets = opts.targets ?? await discoverCourtbitTargets(deps);
      result.tournaments = targets.length;
      for (const target of targets) {
        if ((failures.get(target.url)?.retryAt ?? 0) > Date.now()) { result.skipped++; continue; }
        let response;
        try {
          response = await client.fetch(deps.httpClient, target.url, target.expectedName);
          failures.delete(target.url);
        } catch (err) {
          const count = (failures.get(target.url)?.count ?? 0) + 1;
          failures.set(target.url, { count, retryAt: Date.now() + Math.min(60000, 5000 * 2 ** Math.min(count - 1, 4)) });
          result.errors++; deps.logger.warn({ err, tournamentId: target.tournamentId }, 'CourtBit fetch failed'); continue;
        }
        result.errors += response.feed.rejected;
        const ctx = await loadCourtbitContext(deps.supabase, target.tournamentId);
        const seen = new Set<string>();
        for (const row of response.feed.matches) {
          const category = row.category === 'Femenino' ? 'women' : 'men';
          // Audit every published player, not only today's live cards.
          for (const player of [...row.a.players, ...row.b.players]) {
            const key = `${category}:${courtbitPlayerKey(player)}`;
            if (seen.has(key)) continue;
            seen.add(key); result.players++;
            const resolved = resolveCourtbitPlayer(player, category, ctx);
            if (!resolved.found) {
              result.unresolvedPlayers++;
              result.issues.push({ providerId: courtbitPlayerKey(player), reason: resolved.reason, candidates: resolved.candidates });
            }
          }
          if (row.status === 'live') result.liveSeen++;
          if (row.status !== 'live' && row.status !== 'done') continue;
          try {
            const resolved = resolveCourtbitMatch(row, ctx);
            if (!resolved.ok) { result.skipped++; result.issues.push({ providerId: row.id, reason: resolved.reason, candidates: resolved.candidates }); continue; }
            if (!['scheduled', 'live', 'on_court'].includes(resolved.status)) { result.skipped++; continue; }
            const snapshot = { ...courtbitToSnapshot(row, resolved.matchId, resolved.orientation), participants: resolved.participants };
            result.resolved++;
            if (opts.dryRun) continue;
            const previous = ctx.cache.get(row.id)?.snapshot ?? null;
            const { data, error } = await deps.supabase.rpc('apply_courtbit_snapshot', {
              p_tournament: target.tournamentId, p_match: resolved.matchId, p_provider_id: row.id,
              p_players: resolved.players, p_names: resolved.expectedNames, p_previous: previous, p_snapshot: snapshot,
              p_links: resolved.links, p_observed_at: response.observedAt,
              p_point_winner: observedPointWinner(previous, snapshot),
            });
            if (error) throw error;
            if (!data || typeof data.applied !== 'boolean') throw new Error('Unexpected CourtBit RPC response');
            if (data.applied) {
              result.applied++;
              if (data.notify && deps.notify) notifyLiveTransition(resolved.matchId, deps.notify);
            } else {
              result.skipped++;
              if (!['unchanged', 'terminal'].includes(data.reason)) result.issues.push({ providerId: row.id, reason: data.reason, candidates: [resolved.matchId] });
            }
          } catch (err) { result.errors++; deps.logger.warn({ err, providerId: row.id }, 'CourtBit match failed'); }
        }
      }
      deps.logger.info({ ...result }, 'CourtBit tick complete');
      return result;
    } finally { running.delete(deps.supabase); }
  };
}
export const runCourtbitLiveFetcher = createCourtbitRunner();
