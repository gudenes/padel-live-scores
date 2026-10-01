/**
 * READ-ONLY auditor for the Momo González (P000011, id d2da1e8c) player-
 * conflation incident.
 *
 * The PlayerResolver fuzzy path bound several non-Momo "* González" entries
 * onto Momo's canonical record, poisoned the alias index, and the entry-list
 * populator overwrote his name. This script enumerates the full blast radius
 * BEFORE any write:
 *   - aliases pointing at Momo
 *   - tournament_draws rows that resolved a name to Momo's id
 *   - every match slot referencing Momo's id, classified LIKELY_WRONG vs
 *     LIKELY_MOMO (Momo only plays Premier-tier; any fip_* tournament is a
 *     mis-binding), plus same-id-in-both-pair-slots flags
 *
 * Read-only by default. With --apply it performs the Phase-A data fix
 * (idempotent): restore Momo's name, delete the 2 poisoned aliases, repoint
 * the 3 Lanzarote matches + 2 draw rows to the real Juan Pereiro record, and
 * re-point the 228 corrupted Lanzarote entry_list_snapshots fip_ids.
 *
 *   node scripts/audit-momo-conflation.mjs            # audit only
 *   node scripts/audit-momo-conflation.mjs --apply    # audit + fix
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MOMO = 'd2da1e8c-5bdc-4c46-b5b5-9d680e167153';
// Levels Momo (rank 14) actually plays. Anything fip_* is a mis-binding.
const PREMIER = new Set(['p1', 'p2', 'major', 'finals', 'wpt_1000', 'wpt_500', 'wpt_final', 'wpt_master']);
// Normalized names that legitimately ARE Momo.
const MOMO_NAMES = new Set(['jeronimo gonzalez', 'momo gonzalez']);
const norm = (s) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const SLOTS = ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id'];

// ── 1. Aliases pointing at Momo ────────────────────────────────────────────
const { data: aliases } = await sb
  .from('entity_external_ids')
  .select('external_id, metadata, first_seen_at')
  .eq('entity_type', 'player').eq('source', 'alias').eq('entity_id', MOMO);
console.log(`\n=== ALIASES → Momo (${aliases?.length ?? 0}) ===`);
for (const a of aliases ?? [])
  console.log(`  "${a.external_id}"  (norm="${a.metadata?.normalized ?? norm(a.external_id)}", since ${a.first_seen_at?.slice(0,10)})`);

// ── 2. Draw rows that resolved a name to Momo's id ─────────────────────────
const { data: draws } = await sb
  .from('tournament_draws')
  .select('tournament_id, category, draw_position, player1_name, player1_id, player2_name, player2_id')
  .or(`player1_id.eq.${MOMO},player2_id.eq.${MOMO}`);
console.log(`\n=== tournament_draws referencing Momo (${draws?.length ?? 0}) ===`);
const drawNameByTournament = new Map(); // tournament_id -> Set of names resolved to Momo
for (const d of draws ?? []) {
  const name = d.player1_id === MOMO ? d.player1_name : d.player2_name;
  if (!drawNameByTournament.has(d.tournament_id)) drawNameByTournament.set(d.tournament_id, new Set());
  drawNameByTournament.get(d.tournament_id).add(name);
}

// ── 3. Every match slot referencing Momo ───────────────────────────────────
const matchMap = new Map(); // matchId -> match row
for (const slot of SLOTS) {
  const { data } = await sb
    .from('matches')
    .select('id, tournament_id, round, status, category, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .eq(slot, MOMO);
  for (const m of data ?? []) matchMap.set(m.id, m);
}
const matches = [...matchMap.values()];

// Tournaments
const tIds = [...new Set(matches.map((m) => m.tournament_id).filter(Boolean))];
const tourns = new Map();
for (let i = 0; i < tIds.length; i += 200) {
  const { data } = await sb.from('tournaments').select('id, name, level, status').in('id', tIds.slice(i, i + 200));
  for (const t of data ?? []) tourns.set(t.id, t);
}

// All referenced player ids (for partner-name context + suggested-correct lookup)
const allIds = new Set();
for (const m of matches) for (const s of SLOTS) if (m[s]) allIds.add(m[s]);
const pname = new Map();
const idList = [...allIds];
for (let i = 0; i < idList.length; i += 200) {
  const { data } = await sb.from('players').select('id, name, ranking, fip_id').in('id', idList.slice(i, i + 200));
  for (const p of data ?? []) pname.set(p.id, p);
}

// ── 4. Classify ────────────────────────────────────────────────────────────
// Momo's real partners are elite. A partner ranked worse than this (or
// unranked) in a Momo pairing is implausible → conflation suspect.
const PARTNER_RANK_LIMIT = 150;
const partnerOf = (m) => {
  if (m.pair1_player1_id === MOMO) return m.pair1_player2_id;
  if (m.pair1_player2_id === MOMO) return m.pair1_player1_id;
  if (m.pair2_player1_id === MOMO) return m.pair2_player2_id;
  if (m.pair2_player2_id === MOMO) return m.pair2_player1_id;
  return null;
};

const wrong = [];
const dupSlot = [];
const momoOk = [];
for (const m of matches) {
  const t = tourns.get(m.tournament_id);
  const level = t?.level ?? '(unknown)';
  const premier = PREMIER.has(level);
  const slotsHit = SLOTS.filter((s) => m[s] === MOMO);
  const pair2dup = m.pair2_player1_id === MOMO && m.pair2_player2_id === MOMO;
  const pair1dup = m.pair1_player1_id === MOMO && m.pair1_player2_id === MOMO;
  if (pair1dup || pair2dup) dupSlot.push(m);

  // suggested correct name(s) from this tournament's draw rows that mapped to Momo
  const drawNames = [...(drawNameByTournament.get(m.tournament_id) ?? [])];
  const foreignDrawNames = drawNames.filter((n) => !MOMO_NAMES.has(norm(n)));

  // implausible partner: ranked > limit or unranked (but not when it's Momo
  // himself via the dup bug, which we flag separately)
  const partnerId = partnerOf(m);
  const partner = partnerId && partnerId !== MOMO ? pname.get(partnerId) : null;
  const implausiblePartner = !pair1dup && !pair2dup && partnerId && partnerId !== MOMO
    && (partner?.ranking == null || partner.ranking > PARTNER_RANK_LIMIT);

  const verdict = pair1dup || pair2dup || foreignDrawNames.length > 0 || implausiblePartner;
  const row = { m, t, level, premier, slotsHit, drawNames, foreignDrawNames, pair1dup, pair2dup, partner, implausiblePartner };
  if (verdict) wrong.push(row);
  else momoOk.push(row);
}

const fmt = (id) => {
  const p = pname.get(id);
  return p ? `${p.name}${p.ranking != null ? ` (r${p.ranking})` : ''}` : id?.slice(0, 8) ?? '—';
};

console.log(`\n=== MATCH SLOTS referencing Momo: ${matches.length} matches ===`);
console.log(`    LIKELY_WRONG: ${wrong.length}   LIKELY_MOMO: ${momoOk.length}   same-id-both-slots: ${dupSlot.length}`);

console.log(`\n--- LIKELY_WRONG (need repoint) ---`);
for (const r of wrong.sort((a, b) => (a.level).localeCompare(b.level))) {
  const m = r.m;
  const reasons = [];
  if (r.pair1dup) reasons.push('pair1 BOTH slots=Momo');
  if (r.pair2dup) reasons.push('pair2 BOTH slots=Momo');
  if (r.foreignDrawNames.length) reasons.push(`draw-name="${r.foreignDrawNames.join('|')}"`);
  if (r.implausiblePartner) reasons.push(`implausible partner=${r.partner ? `${r.partner.name} r${r.partner.ranking ?? '—'}` : '?'}`);
  reasons.push(`tier=${r.level}`);
  console.log(`  ${m.id}  [${r.level}] ${r.t?.name ?? '?'} ${m.round ?? ''} ${m.status}`);
  console.log(`     P1: ${fmt(m.pair1_player1_id)} / ${fmt(m.pair1_player2_id)}`);
  console.log(`     P2: ${fmt(m.pair2_player1_id)} / ${fmt(m.pair2_player2_id)}`);
  console.log(`     why: ${reasons.join('; ')}`);
}

console.log(`\n--- LIKELY_MOMO (Premier-tier, looks legit) : ${momoOk.length} ---`);
const byLevel = {};
for (const r of momoOk) byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
console.log('   ', JSON.stringify(byLevel));

// suggested-correct record resolution for foreign draw names
const foreignNames = new Set();
for (const r of wrong) for (const n of r.foreignDrawNames) foreignNames.add(n);
if (foreignNames.size) {
  console.log(`\n=== SUGGESTED correct records for foreign draw-names ===`);
  for (const n of foreignNames) {
    const { data: cands } = await sb.from('players')
      .select('id, name, ranking, fip_id, country')
      .eq('normalized_name', norm(n)).eq('category', 'men');
    const others = (cands ?? []).filter((c) => c.id !== MOMO);
    console.log(`  "${n}" → ${others.length ? others.map((c) => `${c.id.slice(0,8)} ${c.name} fip=${c.fip_id} r${c.ranking}`).join(' | ') : 'NO non-Momo record (would need create)'}`);
  }
}
// ── 5. APPLY (Phase-A data fix) ────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
if (!APPLY) {
  console.log('\nRead-only. Re-run with --apply to perform the Phase-A data fix.');
  process.exit(0);
}

const JP = '6b56dfd8-0d42-4c0b-af8a-b304fb691680';     // real Juan Pereiro González (P201895)
const SAULO = '1820d33c-eeec-411d-badd-e726c719b50c';  // Saulo Torres Gonzalez (P201892)
const MOMO_NAME = 'Jeronimo Gonzalez';
console.log('\n=== APPLYING Phase-A fix ===');

// 5.1 Restore Momo's canonical name
{
  const { data, error } = await sb.from('players').update({ name: MOMO_NAME })
    .eq('id', MOMO).neq('name', MOMO_NAME).select('id, name');
  console.log(`  name restore: ${error ? 'ERR ' + error.message : `${data?.length ?? 0} row → "${MOMO_NAME}"`}`);
}

// 5.2 Delete the 2 poisoned aliases
{
  const { data, error } = await sb.from('entity_external_ids').delete()
    .eq('entity_type', 'player').eq('source', 'alias').eq('entity_id', MOMO)
    .in('external_id', ['Juan Pereiro González', 'J Gonzalez']).select('external_id');
  console.log(`  alias delete: ${error ? 'ERR ' + error.message : `${data?.length ?? 0} removed (${(data ?? []).map((d) => d.external_id).join(', ')})`}`);
}

// 5.3 Repoint the 3 Lanzarote matches (idempotent: only flips slots still == MOMO)
const MATCH_FIXES = [
  { id: '483da4e0-0a74-467b-a28b-fbfefc98d2d8', set: { pair2_player1_id: JP, pair2_player2_id: SAULO }, slots: ['pair2_player1_id', 'pair2_player2_id'] },
  { id: '4c382db1-d2cd-4848-a8a5-ee1e417868bb', set: { pair1_player1_id: JP }, slots: ['pair1_player1_id'] },
  { id: '99adcb1a-5e65-401a-89e9-a12083d63478', set: { pair1_player1_id: JP }, slots: ['pair1_player1_id'] },
];
for (const f of MATCH_FIXES) {
  const { data: cur } = await sb.from('matches').select('id, ' + f.slots.join(', ')).eq('id', f.id).single();
  const safe = cur && f.slots.every((s) => cur[s] === MOMO);
  if (!safe) { console.log(`  match ${f.id.slice(0, 8)}: SKIP (slots no longer all MOMO — current ${JSON.stringify(cur)})`); continue; }
  const { error } = await sb.from('matches').update(f.set).eq('id', f.id);
  console.log(`  match ${f.id.slice(0, 8)}: ${error ? 'ERR ' + error.message : 'repointed → ' + JSON.stringify(f.set).replace(/"/g, '')}`);
}

// 5.4 Fix the 2 draw rows
{
  const { data, error } = await sb.from('tournament_draws').update({ player1_id: JP })
    .in('id', ['5c9a0f72-5b7c-4f9d-966f-b0c06950709c', 'f4a3b247-2bb9-431a-8b82-c88655aa3ff8'])
    .eq('player1_id', MOMO).select('id, draw_position');
  console.log(`  draw rows: ${error ? 'ERR ' + error.message : `${data?.length ?? 0} repointed → JP`}`);
}

// 5.5 Re-point corrupted Lanzarote snapshots (P000011 + Juan Pereiro → P201895)
{
  const { data, error } = await sb.schema('padelgod').from('entry_list_snapshots')
    .update({ fip_id: 'P201895' })
    .eq('fip_id', 'P000011').eq('name', 'Juan Pereiro González').select('id');
  console.log(`  snapshots: ${error ? 'ERR ' + error.message : `${data?.length ?? 0} re-pointed P000011→P201895`}`);
}

console.log('\nDone (applied). Re-run without --apply to verify LIKELY_WRONG = 0.');
