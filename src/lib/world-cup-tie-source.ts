import { parseCupStreams } from './world-cup-parser';
import type { CupTie } from './world-cup';
export interface CupTieSnapshot { ties: CupTie[]; fetched_at: string }
/** Prefer the scheduled snapshot, with direct FIP fallback during rollout/outages. */
export async function loadCupTies(deps: {
  loadSnapshot: () => Promise<CupTieSnapshot | null>;
  fetchPage: () => Promise<string>;
  now?: Date;
}): Promise<{ ties: CupTie[]; partial: boolean; fetchedAt: string }> {
  const now = deps.now ?? new Date();
  let snapshot: CupTieSnapshot | null = null;
  try { snapshot = await deps.loadSnapshot(); } catch { /* Fallback before migration/deploy. */ }
  const age = snapshot ? now.getTime() - Date.parse(snapshot.fetched_at) : Infinity;
  const usable = snapshot && Array.isArray(snapshot.ties) && snapshot.ties.length > 0
    && Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000;
  if (snapshot && usable && age <= 15 * 60 * 1000) {
    return { ties: snapshot.ties, partial: false, fetchedAt: snapshot.fetched_at };
  }
  try {
    const ties = parseCupStreams(await deps.fetchPage(), now);
    if (ties.length) return { ties, partial: false, fetchedAt: now.toISOString() };
  } catch { /* Retain recent confirmed announcements; don't renew live timestamps. */ }
  if (snapshot && usable) return { ties: snapshot.ties, partial: true, fetchedAt: snapshot.fetched_at };
  return { ties: [], partial: true, fetchedAt: now.toISOString() };
}
