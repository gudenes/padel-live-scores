import {playerEvolution} from './insights'
import {activeEvents,replay,type ScoutDoc} from './model'
export interface ScoutPerson {id:string;name:string;avatar_url?:string|null;photo_url?:string|null}
export function sessionExport(matchId:string,players:ScoutPerson[],revision:number,document:ScoutDoc){
 const summary=replay(document)
 return {schemaVersion:2,exportedAt:new Date().toISOString(),matchId,players,revision,document,activeEventIds:activeEvents(document).map(e=>e.id),summary,playerEvolution:playerEvolution(summary.tracking.timeline),definitions:{netActions:'Winners minus unforced errors, forced errors and double faults; equal weights, not Pi rating.',lead:'Cumulative observed points won by pair A minus pair B; not win probability.',duration:'Milliseconds from first serve to point completion, including time between serves. Null means not observed.',history:'Document events include undo actions; summary and timeline contain only active observations.',coverage:'Manually observed data only. Score corrections do not reconstruct earlier points.'}}
}
export function pointsCsv(players:ScoutPerson[],doc:ScoutDoc){
 const cell=(v:unknown)=>'"'+(typeof v==='string'?v.replace(/^[=+@\-\t\r]/,"'$&"):String(v??'')).replaceAll('"','""')+'"'
 const rows:unknown[][]=[['point','event_id','ended_at','rally_started_at','duration_ms','server_id','server_name','player_id','player_name','winning_pair','outcome','smash','first_fault_at','double_fault','star_point','break_point_pair','break_converted','set_point_a','set_point_b','match_point_a','match_point_b','sets_before','points_a_before','points_b_before','sets_after','points_a_after','points_b_after','observed_point_lead_a']]
 for(const p of replay(doc).tracking.timeline)rows.push([p.number,p.id,p.at,p.rallyStartedAt,p.durationMs,players[p.server].id,players[p.server].name,p.player===null?null:players[p.player].id,p.player===null?null:players[p.player].name,p.winner,p.outcome,p.smash,p.firstFaultAt,p.outcome==='double_fault',p.star,p.breakPoint,p.breakConverted,p.setPoint.a,p.setPoint.b,p.matchPoint.a,p.matchPoint.b,JSON.stringify(p.before.sets),p.before.currentGame.a,p.before.currentGame.b,JSON.stringify(p.after.sets),p.after.currentGame.a,p.after.currentGame.b,p.lead])
 return rows.map(row=>row.map(cell).join(',')).join('\r\n')
}
