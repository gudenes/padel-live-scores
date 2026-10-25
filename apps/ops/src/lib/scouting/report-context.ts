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
        : `select m.duration,m.round,m.category,m.status,m.winner_pair,m.scheduled_at,t.name as tournament, array[m.pair1_player1_id,m.pair1_player2_id,m.pair2_player1_id,m.pair2_player2_id] as player_ids from matches m left join tournaments t on t.id=m.tournament_id where m.id=$1`,
      [id]
    );
    const match = result.rows[0];
    if (!match) return empty;
    const ids = (
      manual
        ? (match.players ?? []).map((p: { id: string; existingPlayerId?: string }) => p.existingPlayerId ?? p.id)
        : match.player_ids ?? []
    ).filter(
      (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)
    );
    const avatars = ids.length
      ? (
          await db.query(
            "select id,name,display_name,avatar_url from players where id=any($1::uuid[])",
            [ids]
          )
        ).rows
      : [];
    const pbp = manual
      ? []
      : (
          await db.query(
            `select p.id,p.game_id,p.point_number,p.winner_pair,p.score_after,p.server_player_id,p.is_break_point,p.is_set_point,p.is_match_point,s.set_number,g.game_number
             from match_points p join sets s on s.id=p.set_id join games g on g.id=p.game_id
             where p.match_id=$1 order by s.set_number,g.game_number,p.point_number,p.id`,
            [id]
          )
        ).rows;
    const sets = manual
      ? []
      : (
          await db.query(
            "select set_number,pair1_games as a,pair2_games as b from sets where match_id=$1 order by set_number",
            [id]
          )
        ).rows;
    const games = manual
      ? []
      : (
          await db.query(
            "select g.id,s.set_number,g.game_number,g.winner_pair,g.server_player_id,g.is_tiebreak,g.game_score,g.points from games g join sets s on s.id=g.set_id where g.match_id=$1 order by s.set_number,g.game_number",
            [id]
          )
        ).rows;
    return {
      players: manual
        ? (match.players ?? []).map((p: {id:string;existingPlayerId?:string})=>({...p,profileId:avatars.find(a=>a.id===(p.existingPlayerId??p.id))?.id??null}))
        : match.player_ids.map(
            (id: string | null, i: number) =>
              avatars.find((p) => p.id === id) ?? {
                id: id ?? "unknown-" + i,
                name: "Player TBC",
              }
          ),
      sets: sets.filter((s) => Number.isInteger(s.a) && Number.isInteger(s.b)),
      games,
      status: match.status ?? null,
      winnerPair: match.winner_pair ?? null,
      meta: {
        duration: match.duration ?? null,
        round: match.round ?? null,
        category: match.category ?? null,
        tournament: match.tournament ?? null,
        scheduled_at: match.scheduled_at
          ? new Date(match.scheduled_at).toISOString()
          : null,
      },
      avatars: manual
        ? Object.fromEntries((match.players ?? []).map((p: {id:string;existingPlayerId?:string}) => [p.id, avatars.find(a=>a.id===(p.existingPlayerId??p.id))?.avatar_url ?? null]))
        : Object.fromEntries(avatars.map((p) => [p.id, p.avatar_url])),
      pbp,
    };
  } catch {
    return { ...empty, unavailable: true };
  }
}
