import {getDeuceRule} from './scoring';
import {replaySource} from '../../../../../extensions/scouting-video-overlay/replay-source.mjs';
import { scopedStats, teamSummary } from "./insights";
import {
  methodologyAnalysis,
  pointWeight,
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
  players?:{profileId?:string|null;existingPlayerId?:string;id:string;name:string;display_name?:string|null;avatar_url?:string|null}[];
  sets?:{a:number;b:number;set_number?:number}[];
  games?:OfficialGame[];
  status?:string|null;
  winnerPair?:number|null;
  unavailable?: boolean;
}
export function compactPlayerName(name:string){
 const parts=name.trim().split(/\s+/)
 return parts.length>1?`${parts[0][0]}. ${parts.slice(1).join(' ')}`:name
}
/** Normalize the first recorded court arrangement to team A at the near end. */
export function recordedCourtSlots(rallies:ViewRally[]){
 const fallback=[{x:.28,y:.697},{x:.72,y:.697},{x:.66,y:.249},{x:.34,y:.249}]
 const order=rallies.flatMap(r=>r.touches).map(t=>t.order).find(o=>o?.length===4&&new Set(o).size===4&&o.every(p=>Number.isInteger(p)&&p>=0&&p<4)&&Math.floor(o[0]/2)===Math.floor(o[1]/2)&&Math.floor(o[2]/2)===Math.floor(o[3]/2))
 if(!order)return fallback
 const normalized=order[2]<2?order:[...order].reverse()
 const positions=[{x:.34,y:.249},{x:.66,y:.249},{x:.28,y:.697},{x:.72,y:.697}]
 return fallback.map((_,player)=>positions[normalized.indexOf(player)])
}
/** Next recorded hitter by identity, independent of illustrative court positions. */
export function receiverCounts(rallies: ViewRally[]) {
  const players = Array.from({length:4},()=>({shots:0,receivers:[0,0,0,0],unknown:0}));
  const incoming = [0,0,0,0];
  let excluded = 0;
  const validPlayer=(p:number)=>Number.isInteger(p)&&p>=0&&p<4;
  for(const rally of rallies) rally.touches.forEach((touch,i)=>{
    const next=rally.touches[i+1];
    const valid=next&&validPlayer(touch.player)&&validPlayer(next.player)&&Math.floor(touch.player/2)!==Math.floor(next.player/2);
    if(next&&!valid)excluded++;
    if(!validPlayer(touch.player))return;
    const row=players[touch.player];row.shots++;
    if(valid){row.receivers[next.player]++;incoming[next.player]++;}else row.unknown++;
  });
  return {players,incoming,excluded};
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
            keyPointAnalysis: methodologyAnalysis(points.filter(p => pointWeight(p) > 1), methodology),
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
    videoUrl: replaySource((report.original as {setup?:{videoSourceUrl?:string}})?.setup?.videoSourceUrl),
    meta: context.meta,
    players: report.players.map((p) => ({
      ...p,
      ...({profileId: context.players?.find(profile=>profile.id===p.id)?.profileId !== undefined ? context.players?.find(profile=>profile.id===p.id)?.profileId : p.id} as {profileId?:string|null}),
      shortName: compactPlayerName(context.players?.find(profile=>profile.id===p.id)?.display_name || p.name),
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
    scoreOnlyPoints: report.scoreOnlyPoints,
    hasScoreAdjustments: report.hasScoreAdjustments,
    source: report.source,
    finished: report.model.score.phase === "finished",
    winner: report.model.score.winner,
    elapsedMs: elapsed,
    scoringRule: getDeuceRule(report.model.score.config),
    contextUnavailable: context.unavailable ?? false,
  };
}
export type ReportView = ReturnType<typeof reportView>;
