import "server-only";
import { auth } from "@/lib/auth";
import { canViewReports } from "@/lib/scouting-permissions";
import { pgPool } from "@/lib/db";
import type { ReportContext } from "./report-view";
export async function reportContext(
  id: string,
  manual = false
): Promise<ReportContext> {
  const empty: ReportContext = {
    meta: {
      duration: null,
      round: null,
      category: null,
      tournament: null,
      scheduled_at: null,
    },
    avatars: {},
    pbp: [],
  };
  if (!canViewReports((await auth())?.user)) return empty;
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return empty;
  try {
    const db = pgPool();
    const result = await db.query(
      manual
        ? `select tournament_label as tournament,match_date::text as scheduled_at,players from operator_manual_scouting_matches where id=$1`
        : `select m.duration,m.round,m.category,m.scheduled_at,t.name as tournament, array[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id] as player_ids from matches m left join tournaments t on t.id=m.tournament_id where m.id=$1`,
      [id]
    );
    const match = result.rows[0];
    if (!match) return empty;
    const ids = (
      manual
        ? (match.players ?? []).map((p: { id: string }) => p.id)
        : match.player_ids ?? []
    ).filter(
      (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)
    );
    const avatars = ids.length
      ? (
          await db.query(
            "select id,avatar_url from players where id=any($1::uuid[])",
            [ids]
          )
        ).rows
      : [];
    const pbp = manual
      ? []
      : (
          await db.query(
            "select winner_pair,score_after from match_points where match_id=$1 order by created_at,id",
            [id]
          )
        ).rows;
    return {
      meta: {
        duration: match.duration ?? null,
        round: match.round ?? null,
        category: match.category ?? null,
        tournament: match.tournament ?? null,
        scheduled_at: match.scheduled_at
          ? new Date(match.scheduled_at).toISOString()
          : null,
      },
      avatars: Object.fromEntries(avatars.map((p) => [p.id, p.avatar_url])),
      pbp,
    };
  } catch {
    return { ...empty, unavailable: true };
  }
}
