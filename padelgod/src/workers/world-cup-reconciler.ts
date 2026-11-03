import { load } from 'cheerio';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCountry } from '../lib/country.js';
import { hasDuplicatePlayerIds, MATCH_PLAYER_COLUMNS } from '../lib/match-player-identity.js';

import { WORLD_CUP_ID, isWorldCupActive } from '../lib/world-cup-event.js';
export { WORLD_CUP_ID } from '../lib/world-cup-event.js';
const ENTRY_URL = 'https://widget.matchscorerlive.com/screen/entrylist/FIP-2026-4516?t=tol&theme=1';
export interface Squad { country: string; category: string; names: string[] }
export interface Profile { id: string; name: string; display_name: string | null; country: string | null; category: string | null; fip_id?: string | null }
const key = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
export function parseWorldCupSquads(html: string): Squad[] {
  const $ = load(html), squads: Squad[] = [];
  $('.tab-pane').each((_, pane) => {
    const title = $(`[data-target="#${$(pane).attr('id')}"]`).text();
    const category = /\bWOMEN\b/i.test(title) ? 'women' : /\bMEN\b/i.test(title) ? 'men' : null;
    if (!category) return;
    $(pane).find('.card').each((_, card) => {
      const country = normalizeCountry($(card).find('.card-header img').attr('src')?.match(/\/([A-Z]{2,3})\.jpg/i)?.[1]);
      if (!country) return;
      const names: string[] = [];
      $(card).find('.card-body > .m-2').each((_, row) => {
        const first = $(row).children('.mr-2').text().trim(), last = $(row).children('.text-uppercase').text().trim();
        if (first && last) names.push(`${first} ${last}`);
      });
      squads.push({ country, category, names });
    });
  });
  return squads;
}
// Reviewed against the official profile's playerID on 2026-11-03.
// Scoped to this event roster: represented country is not necessarily nationality.
// Do not add an identity with conflicting FIP IDs without resolving that conflict.
const verifiedRosterIdentities = [
  ['women', 'SE', 'Amanda Girdo', 'P200116', 'amanda-girdo'],
  ['men', 'QA', 'Khalid Saadon Alkuwari', 'P201001', 'khalid-saadon-alkuwari'],
  ['men', 'MX', 'Moises Rafael Rivero', 'P100877', 'moises-rafael-rivero'],
  ['men', 'US', 'Vinny Nahuel Di Francesco', 'P100616', 'vinny-nahuel-di-francesco'],
  ['men', 'US', 'Daniel Elohim Fernandez Guerra', 'P205636', 'daniel-elohim-fernandez-guerra'],
  ['men', 'AE', 'Abdulrahman Al Janahi', 'P100263', 'abdulrahman-al-janahi'],
  ['men', 'MX', 'Eduardo Agustin Torre', 'P100879', 'eduardo-agustin-torre'],
].map(([category, country, name, fipId, slug]) => ({
  category, country, name: key(name!), fipId,
  source: `https://www.padelfip.com/player/${slug}/`,
}));

/** Initial + complete surname must identify exactly one member of the published squad. */
export function resolveWorldCupPlayer(raw: string, country: string, category: string, squads: Squad[], profiles: Profile[]): string | null {
  const candidates = squads.filter(s => s.country === normalizeCountry(country) && s.category === category).flatMap(s => s.names);
  const tokens = key(raw).split(' ');
  const names = candidates.filter(name => {
    const full = key(name);
    if (full === key(raw)) return true;
    if (tokens.length < 2 || tokens[0]!.length !== 1) return false;
    return full.startsWith(tokens[0]!) && full.endsWith(` ${tokens.slice(1).join(' ')}`);
  });
  if (names.length !== 1) return null;
  const full = key(names[0]!);
  const gender = profiles.filter(p => p.category === category);
  const verified = verifiedRosterIdentities.find(identity =>
    identity.category === category && identity.country === normalizeCountry(country) && identity.name === full);
  if (verified) {
    const identified = gender.filter(p => p.fip_id === verified.fipId);
    // An authoritative identity must still map to exactly one database row.
    return identified.length === 1 ? identified[0]!.id : null;
  }
  const matches = (p: Profile) => [p.name, p.display_name].some(n => {
    if (!n) return false;
    const other = key(n);
    if (other === full || other.startsWith(`${full} `)) return true;
    // Either source may omit middle given names. Keep full first/last names
    // and every remaining token in order; uniqueness is still mandatory.
    const a = full.split(' '), b = other.split(' ');
    if (a[0] !== b[0] || a.at(-1) !== b.at(-1)) return false;
    const [short, long] = a.length < b.length ? [a,b] : [b,a];
    if (short.length < 2 || short[0]!.length < 2) return false;
    let index = 0;
    for (const token of long) if (token === short[index]) index++;
    return index === short.length;
  });
  // Roster membership supplies the represented country; nationality can differ (e.g. UAE).
  const local = gender.filter(p => normalizeCountry(p.country) === normalizeCountry(country) && matches(p));
  const found = local.length ? local : gender.filter(matches);
  return found.length === 1 ? found[0]!.id : null;
}
export async function runWorldCupReconciler({ supabase, dryRun = true }: { supabase: SupabaseClient; dryRun?: boolean }) {
  const { data: matches, error } = await supabase.from('matches').select('*').eq('tournament_id', WORLD_CUP_ID);
  if (error) throw error;
  const thin = (matches ?? []).filter(m => MATCH_PLAYER_COLUMNS.some(k => !m[k]));
  if (!thin.length) return { proposed: 0, updated: 0, unresolved: 0 };
  const response = await fetch(ENTRY_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`World Cup entry list: ${response.status}`);
  const squads = parseWorldCupSquads(await response.text());
  if (!squads.length) throw new Error('World Cup entry list contained no squads');
  const profiles: Profile[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('players').select('id,name,display_name,country,category,fip_id').in('category', ['men','women']).order('id').range(offset, offset + 999);
    if (error) throw error;
    profiles.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  let proposed = 0, updated = 0, unresolved = 0;
  for (const match of thin) {
    const patch: Record<string, string> = {};
    for (const column of MATCH_PLAYER_COLUMNS) {
      if (match[column]) continue;
      const prefix = column.slice(0, -3);
      const id = resolveWorldCupPlayer(match[`${prefix}_name`] ?? '', match[`${prefix}_country`] ?? '', match.category, squads, profiles);
      if (id) patch[column] = id; else unresolved++;
    }
    if (!Object.keys(patch).length || hasDuplicatePlayerIds(MATCH_PLAYER_COLUMNS.map(k => patch[k] ?? match[k]))) continue;
    proposed += Object.keys(patch).length;
    if (dryRun) continue;
    // Compare the complete lineup and raw names: never overwrite a concurrently corrected match.
    let query = supabase.from('matches').update(patch).eq('id', match.id).eq('tournament_id', WORLD_CUP_ID);
    for (const column of MATCH_PLAYER_COLUMNS) {
      query = match[column] ? query.eq(column, match[column]) : query.is(column, null);
      for (const suffix of ['name', 'country']) {
        const rawColumn = `${column.slice(0, -3)}_${suffix}`;
        query = match[rawColumn] == null ? query.is(rawColumn, null) : query.eq(rawColumn, match[rawColumn]);
      }
    }
    const result = await query.select('id');
    if (result.error) throw result.error;
    if (result.data?.length) updated += Object.keys(patch).length;
  }
  return { proposed, updated, unresolved };
}

let scheduledRunActive = false;
/** Independent event-scoped task: unrelated reconciler failures cannot starve player links. */
export async function runScheduledWorldCupReconciler(deps: { supabase: SupabaseClient; dryRun?: boolean }) {
  if (!isWorldCupActive()) return { skipped: 'outside-event' };
  if (scheduledRunActive) return { skipped: 'already-running' };
  scheduledRunActive = true;
  try {
    return await runWorldCupReconciler(deps);
  } finally {
    scheduledRunActive = false;
  }
}
