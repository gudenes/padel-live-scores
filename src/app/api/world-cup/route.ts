import { loadCupTies, type CupTieSnapshot } from '@/lib/world-cup-tie-source';
import { createAnonServerClient } from "@/lib/supabase";
import { normalizeCountry } from "@/lib/country";
import { resolveCupPlayer, type CupPlayerProfile } from "@/lib/world-cup-players";
import { WORLD_CUP, type CupData } from "@/lib/world-cup";
import {
  parseCupGroups,
  parseCupTeams,
} from "@/lib/world-cup-parser";
export const runtime = "nodejs";
async function html(url: string) {
  const response = await fetch(url, {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`FIP upstream ${response.status}`);
  return response.text();
}
export async function GET() {
  const base = `https://widget.matchscorerlive.com/screen`;
  const results = await Promise.allSettled([
    loadCupTies({
      loadSnapshot: async () => {
        const { data, error } = await createAnonServerClient().from('world_cup_tie_snapshots')
          .select('ties,fetched_at').eq('tournament_id', WORLD_CUP.tournamentId).maybeSingle();
        if (error) throw error;
        return data as CupTieSnapshot | null;
      },
      fetchPage: () => html(WORLD_CUP.eventUrl),
    }),
    html(`${base}/entrylist/${WORLD_CUP.widgetCode}?t=tol&theme=1`),
    html(`${base}/groups/${WORLD_CUP.widgetCode}?t=tol&theme=1`),
  ]);
  const source = (i: number) =>
    results[i].status === "fulfilled"
      ? (results[i] as PromiseFulfilledResult<string>).value
      : "";
  const tieSource = results[0].status === 'fulfilled' ? results[0].value : null;
  const data: CupData = {
    ties: tieSource?.ties ?? [],
    teams: parseCupTeams(source(1)),
    groups: parseCupGroups(source(2)),
    fetchedAt: tieSource?.fetchedAt ?? new Date().toISOString(),
    partial: (tieSource?.partial ?? true) || results.some((r) => r.status === "rejected"),
  };
  if (!data.ties.length && !data.teams.length && !data.groups.length)
    return Response.json({ error: "FIP data unavailable" }, { status: 502 });
  try {
    const db = createAnonServerClient();
    const countries = [...new Set(data.teams.map(t => normalizeCountry(t.country)).filter((c): c is string => !!c))];
    const players: CupPlayerProfile[] = [];
    for (let offset = 0; countries.length; offset += 1000) {
      const { data: page, error } = await db.from("players")
        .select("id,name,display_name,country,category,avatar_url")
        .in("country", countries).in("category", ["men", "women"])
        .order("id").range(offset, offset + 999);
      if (error) throw error;
      players.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }
    for (const team of data.teams) {
      team.profiles = {};
      for (const name of team.players) {
        const player = resolveCupPlayer(name, team, players);
        if (player) team.profiles[name] = { id: player.id, name: player.display_name || player.name, avatarUrl: player.avatar_url };
      }
    }
  } catch {
    // The official squads remain usable when the public profile lookup fails.
    data.partial = true;
  }
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
