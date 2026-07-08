// padelgod/src/lib/entry-list-teams.ts
//
// Pure: collapse per-player entry_list_snapshots rows into one descriptor
// per unordered pair. Each snapshot row is a single player carrying their
// own name/country plus partner_fip_id/partner_name. A full pair therefore
// appears as two rows (A→B, B→A); we merge them so both countries survive.
// When only one row exists, we fall back to partner_name (country unknown).
//
// fip_ids are expected already normalized (no "fip-" prefix) by the caller.

export interface EntrySnapshotInput {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string;
  name: string | null;
  country: string | null;
  seed: number | null;
  partner_fip_id: string | null;
  partner_name: string | null;
  draw_type: string | null;
}

export interface EntryTeam {
  tournament_id: string;
  category: 'men' | 'women';
  draw_type: string;
  seed: number | null;
  marker: string | null;
  fip1: string;
  name1: string | null;
  country1: string | null;
  fip2: string | null;
  name2: string | null;
  country2: string | null;
}

interface Accum {
  tournament_id: string;
  category: 'men' | 'women';
  draw_type: string;
  seed: number | null;
  players: Map<string, { name: string | null; country: string | null }>;
  partnerNames: Map<string, string | null>;
}

function teamKey(a: string, b: string | null): string {
  if (!b) return a;
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function buildEntryTeams(rows: EntrySnapshotInput[]): EntryTeam[] {
  const groups = new Map<string, Accum>();

  for (const r of rows) {
    const key = teamKey(r.fip_id, r.partner_fip_id);
    let g = groups.get(key);
    if (!g) {
      g = {
        tournament_id: r.tournament_id,
        category: r.category,
        draw_type: r.draw_type ?? 'main_draw',
        seed: null,
        players: new Map(),
        partnerNames: new Map(),
      };
      groups.set(key, g);
    }
    g.players.set(r.fip_id, { name: r.name, country: r.country });
    if (r.seed != null && g.seed == null) g.seed = r.seed;
    // Both rows of a pair are always written with the same draw_type by the
    // upstream fetcher (entry-list-fetcher.ts writes 'main_draw' | 'qualifying'),
    // so the first row's value already wins here — no merge needed.
    if (r.partner_fip_id) g.partnerNames.set(r.partner_fip_id, r.partner_name);
  }

  const teams: EntryTeam[] = [];
  for (const [key, g] of groups) {
    const fips = key.split('::');
    const fA = fips[0] as string;
    const fB = fips.length > 1 ? (fips[1] as string) : null;
    const pA = g.players.get(fA) ?? { name: g.partnerNames.get(fA) ?? null, country: null };
    const pB = fB
      ? (g.players.get(fB) ?? { name: g.partnerNames.get(fB) ?? null, country: null })
      : null;
    teams.push({
      tournament_id: g.tournament_id,
      category: g.category,
      draw_type: g.draw_type,
      // The snapshot "seed" is a per-draw position (main draw 1..N, qualifying
      // 1..M) — NOT a competitive seed shared across draws. Keep it only for the
      // main draw so the entry list reads as a seeded order; qualifying entries
      // are a separate pool surfaced via the `Q` marker, so their position must
      // not render as a duplicate "seed 1/2/3…" alongside the main draw.
      seed: g.draw_type === 'qualifying' ? null : g.seed,
      marker: g.draw_type === 'qualifying' ? 'Q' : null,
      fip1: fA,
      name1: pA.name,
      country1: pA.country,
      fip2: fB,
      name2: pB ? pB.name : null,
      country2: pB ? pB.country : null,
    });
  }
  return teams;
}
