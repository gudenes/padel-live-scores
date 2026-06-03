// padelgod/src/lib/active-tournament-args.ts
//
// Builds the args object for the active-tournament RPCs
// (padelgod_active_tournaments_for_static_workers / _with_slug).
//
// Scheduled worker runs pass no ids → {} → the RPC applies its ±7-day
// window as before. The on-demand refresh passes the targeted tournament
// id(s) → { p_only_ids } → the RPC returns exactly those, bypassing the
// window (it still requires the tournament's active widget / slug). This is
// what lets an operator refresh a finished, out-of-window event.

export function activeTournamentArgs(
  onlyTournamentIds?: Set<string>,
): { p_only_ids?: string[] } {
  return onlyTournamentIds && onlyTournamentIds.size > 0
    ? { p_only_ids: Array.from(onlyTournamentIds) }
    : {};
}
