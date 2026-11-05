import { createAnonServerClient } from "@/lib/supabase";
import { normalizeCountry } from "@/lib/country";
import { resolveCupPlayer, type CupPlayerProfile } from "@/lib/world-cup-players";
import { WORLD_CUP, type CupData } from "@/lib/world-cup";
import { FIP_CHANNEL_ID } from '@/lib/fip-channel';
import { CUP_STREAM_FRESHNESS_MS, matchCupYouTubeStreams } from '@/lib/world-cup-youtube';
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
    html(`${base}/entrylist/${WORLD_CUP.widgetCode}?t=tol&theme=1`),
    html(`${base}/groups/${WORLD_CUP.widgetCode}?t=tol&theme=1`),
  ]);
  const source = (i: number) =>
    results[i].status === "fulfilled"
      ? (results[i] as PromiseFulfilledResult<string>).value
      : "";
  const data: CupData = {
    ties: [],
    teams: parseCupTeams(source(0)),
    groups: parseCupGroups(source(1)),
    fetchedAt: new Date().toISOString(),
    partial: results.some((r) => r.status === "rejected"),
  };
  if (!data.ties.length && !data.teams.length && !data.groups.length)
    return Response.json({ error: "FIP data unavailable" }, { status: 502 });
  try {
    const db = createAnonServerClient();
    const { data: streams, error: streamError } = await db.from('youtube_channel_live')
      .select('video_id,title,started_at,last_seen_at,channel:youtube_channels!inner(channel_id,is_active)')
      .in('channel.channel_id', [FIP_CHANNEL_ID, 'UCK59dYVs3Wgwoe73nDTH6jw'])
      .eq('channel.is_active', true)
      .gt('last_seen_at', new Date(Date.now() - CUP_STREAM_FRESHNESS_MS).toISOString());
    if (streamError) {
      console.error('[world-cup] YouTube broadcast lookup failed:', streamError.message);
      data.partial = true;
    } else {
      data.ties = matchCupYouTubeStreams(streams ?? [], data.teams);
    }
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
