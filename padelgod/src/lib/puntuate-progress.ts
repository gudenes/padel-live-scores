import type { SupabaseClient } from '@supabase/supabase-js';
import type { PuntuateRow } from './puntuate-client.js';
import { inferWinnerFromSets } from './shadow-winner-inference.js';

export function puntuateSets(row: PuntuateRow, orientation: 'AB' | 'BA') {
  const a = orientation === 'AB' ? row.setsA : row.setsB;
  const b = orientation === 'AB' ? row.setsB : row.setsA;
  if (a.length !== b.length || a.length > 3 || [...a,...b].some(n => !Number.isInteger(n) || n < 0 || n > 7)) throw new Error('Invalid Puntuate sets');
  return a.map((games,i) => ({set_number:i+1,pair1_games:games,pair2_games:b[i]!}));
}
/** Only infer from a legal, completed best-of-three score; never from a lead or disappearance. */
export function puntuateWinner(row: PuntuateRow, orientation: 'AB' | 'BA'): 1 | 2 | null {
  const sets = puntuateSets(row, orientation);
  if (sets.length < 2 || sets.some(s => {
    const hi=Math.max(s.pair1_games,s.pair2_games), lo=Math.min(s.pair1_games,s.pair2_games);
    return !((hi===6 && lo<=4)||(hi===7 && (lo===5||lo===6)));
  })) return null;
  if (sets.length===3 && inferWinnerFromSets(sets.slice(0,2)) !== null) return null;
  return inferWinnerFromSets(sets);
}
export async function writePuntuateProgress(db: SupabaseClient, matchId: string, row: PuntuateRow, orientation: 'AB'|'BA', now = new Date()) {
  const winner=puntuateWinner(row,orientation);
  const sets=puntuateSets(row,orientation);
  // Persist every observed set, including sets completed before our first poll.
  for (const s of sets) {
    const {error}=await db.from('sets').upsert({...s,match_id:matchId,set_score:`${s.pair1_games}-${s.pair2_games}`,is_current:!winner && s.set_number===sets.length,updated_at:now.toISOString()},{onConflict:'match_id,set_number'});
    if(error) throw new Error(error.message);
  }
  const minutes=row.durationMinutes;
  const duration=minutes != null ? `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}` : null;
  // Only a running elapsed clock can locate the start; an old finished card cannot.
  if(row.status==='Live' && minutes != null) {
    const {error}=await db.from('matches').update({started_at:new Date(now.getTime()-minutes*60000).toISOString()}).eq('id',matchId).in('status',['scheduled','live','on_court']).is('started_at',null);
    if(error)throw new Error(error.message);
  }
  const patch: Record<string,unknown> = {};
  if(duration)patch.duration=duration;
  // Historical final cards have a play date, not an observed finish timestamp.
  const finishedAt = /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date < now.toISOString().slice(0,10) ? `${row.date}T12:00:00.000Z` : now.toISOString();
  if(winner)Object.assign(patch,{status:'finished',winner_pair:winner,finished_at:finishedAt});
  if(Object.keys(patch).length) {
    const {error}=await db.from('matches').update(patch).eq('id',matchId).in('status',['scheduled','live','on_court']);
    if(error)throw new Error(error.message);
  }
  return winner;
}
