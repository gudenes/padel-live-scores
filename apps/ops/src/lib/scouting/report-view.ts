import { scopedStats, teamSummary } from "./insights";
import {
  methodologyAnalysis,
  DEFAULT_METHODOLOGY,
  type MethodologyId,
} from "./methodology";
import { savedReport } from "./saved-report";
import type { TimelinePoint } from "./tracking";
export interface Touch {
  player: number;
  order: number[];
}
export interface ViewRally {
  id: string;
  touches: Touch[];
  start: number | null;
  end: number | null;
}
export interface OfficialPoint {
  id?:string; winner_pair:number|null; score_after:string|null;
  game_id?:string; set_number?:number; game_number?:number; point_number?:number;
  server_player_id?:string|null; is_break_point?:boolean; is_set_point?:boolean; is_match_point?:boolean;
}
export interface OfficialGame {id:string;set_number:number;game_number:number;winner_pair:number|null;server_player_id:string|null;is_tiebreak:boolean;points?:unknown;game_score?:string|null}
export interface ReportContext {
  meta: {
    duration: string | null;
    round: string | null;
    category: string | null;
    tournament: string | null;
    scheduled_at: string | null;
  };
  avatars: Record<string, string | null>;
  pbp: OfficialPoint[];
  players?:{id:string;name:string;avatar_url?:string|null}[];
  sets?:{a:number;b:number;set_number?:number}[];
  games?:OfficialGame[];
  status?:string|null;
  winnerPair?:number|null;
  unavailable?: boolean;
}
export function directionCounts(rallies: ViewRally[]) {
  const players = Array.from({ length: 4 }, () => ({
    shots: 0,
    crossCourt: 0,
    downTheLine: 0,
    unknown: 0,
  }));
  for (const rally of rallies)
    rally.touches.forEach((touch, i) => {
      const p = players[touch.player];
      if (!p) return;
      p.shots++;
      const next = rally.touches[i + 1],
        order = touch.order ?? [],
        nextOrder = next?.order ?? [],
        from = order.indexOf(touch.player),
        to = next ? order.indexOf(next.player) : -1;
      const valid =
        next &&
        order.length === 4 &&
        new Set(order).size === 4 &&
        order.every((v, j) => v === nextOrder[j]) &&
        from >= 0 &&
        to >= 0 &&
        Math.floor(from / 2) !== Math.floor(to / 2) &&
        Math.floor(touch.player / 2) !== Math.floor(next.player / 2);
      p[
        valid ? (from % 2 === to % 2 ? "downTheLine" : "crossCourt") : "unknown"
      ]++;
    });
  return {
    players,
    shots: players.reduce((sum, p) => sum + p.shots, 0),
    trackedRallies: rallies.filter((r) => r.touches.length).length,
  };
}
export function contextRallies(
  rallies: ViewRally[],
  points: TimelinePoint[],
  selected: number,
  phase: "all" | "serve" | "return"
) {
  if (phase === "all") return rallies;
  const pointMap = new Map(points.map((p) => [p.id, p]));
  return rallies.filter((r) => {
    const server = pointMap.get(r.id)?.server;
    if (
      !Number.isInteger(server) ||
      server === undefined ||
      server < 0 ||
      server > 3
    )
      return false;
    const serving = Math.floor(server / 2) === Math.floor(selected / 2);
    return phase === "serve" ? serving : !serving;
  });
}
export function reportView(
  report: ReturnType<typeof savedReport>,
  context: ReportContext,
  methodology: MethodologyId = DEFAULT_METHODOLOGY
) {
  const all = report.model.tracking.timeline;
  const original = report.original as {
    rallies?: {
      id: string;
      undone?: boolean;
      point?: unknown;
      touches?: Touch[];
      start?: { time?: number };
      end?: { time?: number };
    }[];
  };
  const available =
    report.source === "video"
      ? (original.rallies ?? []).filter((r) => r.point && !r.undone)
      : [];
  const scopes = Object.fromEntries(
    ["all", ...new Set(all.map((p) => String(p.before.sets.length)))].map(
      (key) => {
        const points =
            key === "all"
              ? all
              : all.filter((p) => p.before.sets.length === Number(key)),
          ids = new Set(points.map((p) => p.id)),
          snapshot = scopedStats(report.doc, all, points);
        const taps: ViewRally[] = available
          .filter((r) => ids.has(r.id))
          .map((r) => ({
            id: r.id,
            touches: r.touches ?? [],
            start: r.start?.time ?? null,
            end: r.end?.time ?? null,
          }));
        return [
          key,
          {
            points,
            stats: snapshot.stats,
            service: snapshot.service,
            teams: teamSummary(points, snapshot),
            analysis: methodologyAnalysis(points, methodology),
            directions: directionCounts(taps),
            taps,
          },
        ];
      }
    )
  );
  const elapsed =
    report.model.tracking.startedAt && report.model.tracking.endedAt
      ? Math.max(
          0,
          Date.parse(report.model.tracking.endedAt) -
            Date.parse(report.model.tracking.startedAt)
        )
      : null;
  return {
    meta: context.meta,
    players: report.players.map((p) => ({
      ...p,
      avatar:
        context.avatars[p.id] ??
        p.avatar_url ??
        p.photo_url ??
        "/scouting/player-placeholder.svg",
    })),
    sets: report.model.score.sets,
    scopes,
    pbp: context.pbp,
    pbpCount: context.pbp.length,
    updatedAt: report.updatedAt,
    partial: report.partial,
    source: report.source,
    finished: report.model.score.phase === "finished",
    winner: report.model.score.winner,
    elapsedMs: elapsed,
    contextUnavailable: context.unavailable ?? false,
  };
}
export type ReportView = ReturnType<typeof reportView>;
