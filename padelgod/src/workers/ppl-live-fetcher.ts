import type { SchedulerDeps } from '../scheduler.js';
import { PplClient, type PplEvent } from '../lib/ppl-client.js';
import { pplToSnapshot } from '../lib/ppl-adapter.js';
import { loadPplContext, resolvePplSnapshot, pplPlayerColumns, type PplContext } from '../lib/ppl-resolve.js';

export interface PplRunOptions { dryRun: boolean; eventSlugs?: string[] }
export interface PplRunResult { dryRun: boolean; events: number; seen: number; live: number; finished: number;
  resolved: number; applied: number; skipped: number; errors: number;
  issues: Array<{ id: string; reason: string; candidates?: string[] }> }
/** Uses a real event's window, not speculative fixtures. Explicit eventSlugs
 * permit read-only historical reconciliation; automatic runs cover today ±1d. */
export function activePplEvents(events: PplEvent[], now = Date.now()) {
  return events.filter(e => Date.parse(e.startsAt) <= now + 86400000 && Date.parse(e.endsAt) + 2 * 86400000 > now);
}
export function createPplRunner(client = new PplClient()) {
  const running = new WeakSet<object>();
  const backoff = new Map<string, { failures: number; retry: number }>();
  // Throttle final/scheduled reads; live documents are checked on every tick.
  const readSchedules = new WeakMap<object, Map<string, number>>();
  const contexts = new WeakMap<object, Map<string, { expires: number; context: PplContext }>>();
  const catalogNext = new WeakMap<object, Map<string, number>>();
  return async (deps: SchedulerDeps, opts: PplRunOptions): Promise<PplRunResult> => {
    const result: PplRunResult = { dryRun: opts.dryRun, events: 0, seen: 0, live: 0, finished: 0, resolved: 0, applied: 0, skipped: 0, errors: 0, issues: [] };
    if (running.has(deps.supabase)) { result.skipped++; return result; }
    running.add(deps.supabase);
    let nextRead = readSchedules.get(deps.supabase);
    if (!nextRead) { nextRead = new Map(); readSchedules.set(deps.supabase, nextRead); }
    try {
      const index = await client.index(deps.httpClient);
      const active = new Set(activePplEvents(index).map(e => e.slug));
      const year = new Date().getUTCFullYear();
      const events = opts.eventSlugs ? index.filter(e => opts.eventSlugs!.includes(e.slug)) :
        index.filter(e => Number(e.startsAt.slice(0, 4)) === year && Date.parse(e.endsAt) + 2 * 86400000 > Date.now());
      for (const missing of opts.eventSlugs ?? []) if (!events.some(e => e.slug === missing)) result.issues.push({ id: missing, reason: 'event_not_published' });
      for (const event of events) {
        if ((backoff.get(event.slug)?.retry ?? 0) > Date.now()) { result.skipped++; continue; }
        try {
          const page = await client.event(deps.httpClient, event);
          result.events++;
          let catalog = catalogNext.get(deps.supabase);
          if (!catalog) { catalog = new Map(); catalogNext.set(deps.supabase, catalog); }
          if (!opts.dryRun && (catalog.get(event.slug) ?? 0) <= Date.now()) {
            const { error: onboardingError } = await deps.supabase.rpc('reconcile_ppl_event', { p_event: event, p_fixtures: page.fixtures });
            if (onboardingError) throw onboardingError;
            catalog.set(event.slug, Date.now() + 300_000);
            contexts.get(deps.supabase)?.clear();
          }
          const { data: tournament, error } = await deps.supabase.from('tournaments').select('id,level')
            .eq('source', 'ppl').eq('external_id', event.slug).maybeSingle();
          if (error) throw error;
          if (!tournament) { result.issues.push({ id: event.slug, reason: 'event_requires_onboarding' }); continue; }
          if (tournament.level !== (event.league === 'ppl' ? 'ppl' : 'ppl_ii')) throw new Error('PPL tournament division mismatch');
          if (!opts.eventSlugs && !active.has(event.slug)) continue; // Register future calendar; do not poll future scores.
          let store = contexts.get(deps.supabase);
          if (!store) { store = new Map(); contexts.set(deps.supabase, store); }
          let cached = store.get(tournament.id);
          if (!cached || cached.expires < Date.now()) {
            cached = { expires: Date.now() + 60_000, context: await loadPplContext(deps.supabase, tournament.id) };
            store.set(tournament.id, cached);
          }
          const context = cached.context;
          for (const { id } of page.fixtures) {
            const readKey = `${opts.dryRun ? 'read' : 'write'}:${id}`;
            if ((nextRead.get(readKey) ?? 0) > Date.now()) { result.skipped++; continue; }
            try {
              const doc = await client.match(deps.httpClient, id);
              const snapshot = pplToSnapshot(doc.data, id, doc.revision, page);
              result.seen++;
              if (snapshot.status === 'scheduled') { nextRead.set(readKey, Date.now() + 30_000); continue; }
              if (snapshot.status === 'live') result.live++; else result.finished++;
              const resolved = resolvePplSnapshot(snapshot, context);
              if (!resolved.ok) { result.issues.push({ id, ...resolved }); nextRead.set(readKey, Date.now() + 30_000); continue; }
              result.resolved++;
              if (!opts.dryRun) {
                const { data, error: writeError } = await deps.supabase.rpc('apply_ppl_snapshot', {
                  p_tournament: tournament.id, p_match: resolved.matchId, p_tie_key: resolved.tieKey,
                  p_old_players: resolved.oldPlayers, p_players: resolved.playerIds, p_snapshot: snapshot,
                });
                if (writeError) throw writeError;
                if (!data || typeof data.applied !== 'boolean') throw new Error('Invalid PPL writer response');
                if (data.applied) {
                  result.applied++;
                  const updated = context.matches.find(m => m.id === resolved.matchId);
                  if (updated) {
                    pplPlayerColumns.forEach((column, i) => { updated[column] = resolved.playerIds[i]!; });
                    updated.status = snapshot.status;
                  }
                  context.matchMappings.set(id, resolved.matchId);
                } else {
                  result.skipped++;
                  if (!['unchanged', 'stale_snapshot'].includes(data.reason)) {
                    result.issues.push({ id, reason: data.reason });
                    store.delete(tournament.id);
                    nextRead.set(readKey, Date.now() + 30_000);
                    continue;
                  }
                }
              }
              // A failed commit must remain eligible for retry; only back off after success.
              nextRead.set(readKey, Date.now() + (snapshot.status === 'finished' ? 300_000 : 0));
            } catch (err) {
              result.errors++; nextRead.set(readKey, Date.now() + 30_000);
              result.issues.push({ id, reason: err instanceof Error ? err.message : 'PPL match failed' });
            }
          }
          backoff.delete(event.slug);
        } catch (err) {
          const failures = (backoff.get(event.slug)?.failures ?? 0) + 1;
          backoff.set(event.slug, { failures, retry: Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(failures, 6)) });
          result.errors++; deps.logger.warn({ err, event: event.slug }, 'PPL event failed');
        }
      }
      deps.logger.info(result, 'PPL tick complete');
      return result;
    } finally { running.delete(deps.supabase); }
  };
}
export const runPplLiveFetcher = createPplRunner();
