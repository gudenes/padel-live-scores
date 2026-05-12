/**
 * Audit script: find public.matches rows whose pair FKs disagree with
 * entry_list_snapshots.partner_fip_id.
 *
 * Dry-run by default. Use --apply to NULL the lower-confidence slot
 * (operator triggers the next fip-draw-populator run to re-fill).
 *
 *   npx tsx scripts/audit-mispaired-matches.ts
 *   npx tsx scripts/audit-mispaired-matches.ts --apply
 *   npx tsx scripts/audit-mispaired-matches.ts --tournament <uuid>
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

try {
  const raw = readFileSync('/Users/GuDenes/Projects/padel-live-scores/.env.local', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
} catch {}

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const APPLY = process.argv.includes('--apply');
const tournamentFlag = process.argv.indexOf('--tournament');
const TOURNAMENT_FILTER = tournamentFlag >= 0 ? process.argv[tournamentFlag + 1] : null;

interface Match {
  id: string;
  tournament_id: string;
  category: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

interface EntryRow {
  fip_id: string | null;
  partner_fip_id: string | null;
  category: string;
}

interface Player {
  id: string;
  fip_id: string | null;
}

async function main() {
  // 1. Load matches with both pair FKs filled
  let q = s
    .from('matches')
    .select('id, tournament_id, category, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .not('pair1_player1_id', 'is', null)
    .not('pair1_player2_id', 'is', null)
    .not('pair2_player1_id', 'is', null)
    .not('pair2_player2_id', 'is', null);
  if (TOURNAMENT_FILTER) q = q.eq('tournament_id', TOURNAMENT_FILTER);
  const { data: matches } = await q;
  console.log(`Loaded ${matches?.length ?? 0} matches with all 4 pair FKs filled${TOURNAMENT_FILTER ? ` for tournament ${TOURNAMENT_FILTER}` : ''}`);

  // 2. Build player_id → fip_id map for all FK player ids we'll touch
  const playerIds = new Set<string>();
  for (const m of (matches ?? []) as Match[]) {
    if (m.pair1_player1_id) playerIds.add(m.pair1_player1_id);
    if (m.pair1_player2_id) playerIds.add(m.pair1_player2_id);
    if (m.pair2_player1_id) playerIds.add(m.pair2_player1_id);
    if (m.pair2_player2_id) playerIds.add(m.pair2_player2_id);
  }
  const playerIdToFipId = new Map<string, string>();
  if (playerIds.size > 0) {
    const { data: players } = await s.from('players').select('id, fip_id').in('id', Array.from(playerIds));
    for (const p of (players ?? []) as Player[]) {
      if (p.fip_id) playerIdToFipId.set(p.id, p.fip_id);
    }
  }

  // 3. For each match's tournament+category, load entry-list partner map
  type TKey = string; // `${tournament_id}::${category}`
  const partnerMapCache = new Map<TKey, Map<string, string>>();
  const loadPartnerMap = async (tournamentId: string, category: string): Promise<Map<string, string>> => {
    const key: TKey = `${tournamentId}::${category}`;
    const cached = partnerMapCache.get(key);
    if (cached) return cached;
    const { data: rows } = await s
      .schema('padelgod')
      .from('entry_list_snapshots')
      .select('fip_id, partner_fip_id, category, captured_at')
      .eq('tournament_id', tournamentId)
      .eq('category', category);
    // Use latest captured_at across the category
    const max = (rows ?? []).reduce<string>((acc, r: any) => (r.captured_at > acc ? r.captured_at : acc), '');
    const map = new Map<string, string>();
    for (const r of (rows ?? []) as Array<EntryRow & { captured_at: string }>) {
      if (r.captured_at !== max) continue;
      if (r.fip_id && r.partner_fip_id) map.set(r.fip_id, r.partner_fip_id);
    }
    partnerMapCache.set(key, map);
    return map;
  };

  // 4. Compare and emit mismatches
  type Mismatch = {
    matchId: string;
    tournamentId: string;
    pairLabel: 'pair1' | 'pair2';
    slotA: string; // 'pair1_player1_id'
    slotB: string;
    fipA: string;
    fipB: string;
    expectedPartnerOfA: string;
  };
  const mismatches: Mismatch[] = [];

  for (const m of (matches ?? []) as Match[]) {
    if (!m.category) continue;
    const partnerMap = await loadPartnerMap(m.tournament_id, m.category);
    if (partnerMap.size === 0) continue;

    for (const [aCol, bCol, label] of [
      ['pair1_player1_id', 'pair1_player2_id', 'pair1'] as const,
      ['pair2_player1_id', 'pair2_player2_id', 'pair2'] as const,
    ]) {
      const aPlayerId = m[aCol] as string | null;
      const bPlayerId = m[bCol] as string | null;
      if (!aPlayerId || !bPlayerId) continue;
      const aFip = playerIdToFipId.get(aPlayerId);
      const bFip = playerIdToFipId.get(bPlayerId);
      if (!aFip || !bFip) continue;
      const expectedPartner = partnerMap.get(aFip);
      if (!expectedPartner) continue;
      if (expectedPartner !== bFip) {
        mismatches.push({
          matchId: m.id,
          tournamentId: m.tournament_id,
          pairLabel: label,
          slotA: aCol, slotB: bCol,
          fipA: aFip, fipB: bFip,
          expectedPartnerOfA: expectedPartner,
        });
      }
    }
  }

  console.log(`\nFound ${mismatches.length} mis-paired slot(s).`);
  const byTournament = new Map<string, Mismatch[]>();
  for (const x of mismatches) {
    const arr = byTournament.get(x.tournamentId) ?? [];
    arr.push(x);
    byTournament.set(x.tournamentId, arr);
  }
  for (const [tid, list] of byTournament) {
    console.log(`\n=== Tournament ${tid} — ${list.length} mismatches ===`);
    for (const x of list) {
      console.log(`  match=${x.matchId}  ${x.pairLabel}  ${x.fipA} (paired with ${x.fipB}, expected ${x.expectedPartnerOfA})`);
    }
  }

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to NULL the mis-paired slot B on each match.');
    console.log('(After applying, run fip-draw-populator manually or wait for the next hourly run to re-fill.)');
    return;
  }

  console.log('\n--apply: NULLing the mis-paired slot B FK on each match...');
  for (const x of mismatches) {
    const patch: Record<string, null> = { [x.slotB]: null };
    const { error } = await s.from('matches').update(patch).eq('id', x.matchId);
    if (error) console.error(`  FAIL match=${x.matchId} (${x.slotB}): ${error.message}`);
    else console.log(`  OK   match=${x.matchId} → ${x.slotB} = NULL`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
