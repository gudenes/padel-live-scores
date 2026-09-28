/**
 * Pure helpers for reading the padeldev tournament feed's nested shape.
 *
 * `tournament` mixes fixed metadata keys (name, timezone, …) with dynamic
 * "YYYYMMDD" day keys, each mapping court name → match array. Only the
 * eight-digit keys are days.
 */
import { matchRefFromUrl } from './padeldev-client.js';
import type {
  PadeldevCandidateEntry,
  PadeldevTournamentFeed,
  PadeldevTournamentMatch,
} from './padeldev-types.js';

const DAY_KEY = /^\d{8}$/;

/** Flatten day → court → matches into a flat list, keeping day/court context. */
export function flattenTournamentFeed(
  feed: PadeldevTournamentFeed,
): PadeldevCandidateEntry[] {
  const out: PadeldevCandidateEntry[] = [];
  const t = feed?.tournament ?? {};
  for (const day of Object.keys(t)) {
    if (!DAY_KEY.test(day)) continue;
    const courts = t[day] as Record<string, PadeldevTournamentMatch[]> | undefined;
    if (!courts || typeof courts !== 'object') continue;
    for (const court of Object.keys(courts)) {
      const matches = courts[court];
      if (!Array.isArray(matches)) continue;
      for (const entry of matches) {
        const matchRef = matchRefFromUrl(entry?.url ?? '');
        if (!matchRef) continue;
        out.push({ matchRef, court, day, entry });
      }
    }
  }
  return out;
}

/**
 * An all-zero score is the feed's "not started" sentinel — the match row exists
 * on the order of play but no point has been played. Polling those would flip
 * matches to live before anyone is on court.
 */
export function isNotStarted(score: string): boolean {
  const slots = (score ?? '').trim().split(/\s+/).filter((s) => s.length > 0);
  if (slots.length === 0) return true;
  return slots.every((s) => s === '0-0' || s === '0/0');
}

/** Matches worth fetching a per-match feed for: in progress, not yet finished. */
export function selectLiveEntries(
  entries: PadeldevCandidateEntry[],
): PadeldevCandidateEntry[] {
  return entries.filter(
    (e) => Number(e.entry?.isfinished) !== 1 && !isNotStarted(e.entry?.score ?? ''),
  );
}
