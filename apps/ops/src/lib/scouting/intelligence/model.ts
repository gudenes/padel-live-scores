import type {SavedSession} from '../saved-report'
import {replay,validateDoc,type ScoutDoc} from '../model'
import {scoutingDocument} from '../../../../../../extensions/scouting-video-overlay/match.mjs'
import {methodologyAnalysis,DEFAULT_METHODOLOGY} from '../methodology'
import {decidingPoints} from '../deciding-points'
export type Person={countryRanking?:{rank:number;total:number}|null;id:string;name:string;country:string|null;ranking:number|null;avatar_url:string|null;category:string|null;hand?:string|null;side?:string|null;birthdate?:string|null;height?:number|null;birthplace?:string|null;profile_url?:string|null}
export type Point={id:string;number:number;contributors:string[];player:string|null;outcome:string;shot:string;smash:boolean;recovery:boolean;winner:string;breakPoint:string|null;star:boolean}
export type Match={rallyShots?:number;rallySamples?:number;durationMs?:number|null;id:string;manual:boolean;date:string|null;tournament:string;round:string|null;players:Person[];points:Point[];stats:ReturnType<typeof replay>['stats'];impact:number[];winner:string|null;score:string;partial:boolean;video:boolean;deciders:ReturnType<typeof decidingPoints>;breaks:{a:{won:number;total:number;saved:number;faced:number};b:{won:number;total:number;saved:number;faced:number}}}
export type SessionRow=SavedSession&{match_id:string;source:'video'|'admin';manual:boolean;date:string|null;tournament:string;round:string|null;roster?:Array<{id:string;existingPlayerId?:string}>}
export function convertSession(row:SessionRow,people:Map<string,Person>):Match|null{
 // These records have already passed full video validation on write. Replaying
 // the scoring projection avoids quadratic rally revalidation on directory reads.
 if(row.players.length!==4)throw Error('Four saved players are required.')
 const doc=row.source==='video'?scoutingDocument(row.document) as ScoutDoc:validateDoc(row.document)
 const model=replay(doc)
 const r={doc,model,partial:doc.events.some(e=>e.kind==='score'||e.kind==='unclassified')}
 if(!model.points)return null
 const roster=row.players.map((p,i)=>{const linked=row.roster?.find(x=>x.id===p.id)?.existingPlayerId;const id=linked??p.id;return people.get(id)??{id,name:p.name,country:null,ranking:null,avatar_url:p.avatar_url??null,category:null}})
 // Ambiguous identities cannot be aggregated across matches.
 if(new Set(roster.map(p=>p.id)).size!==4)return null
 const t=r.model.tracking,analysis=methodologyAnalysis(t.timeline,DEFAULT_METHODOLOGY)
 const breaks=Object.fromEntries((['a','b'] as const).map(team=>[team,{won:t.pairs[team].breaks,total:t.pairs[team].breakPoints,saved:t.pairs[team].breakPointsSaved,faced:t.pairs[team].breakPointsFaced}])) as Match['breaks']
 const recorded=row.source==='video'?(row.document as {rallies?:{point?:unknown;undone?:boolean;touches?:unknown[]}[]}).rallies??[]:[]
 const measured=recorded.filter(r=>r.point&&!r.undone&&r.touches?.length)
 const span=t.startedAt&&t.endedAt?Date.parse(t.endedAt)-Date.parse(t.startedAt):null
 const durationMs=row.source==='video'&&!r.partial&&r.model.score.phase==='finished'&&span!==null&&Number.isFinite(span)&&span>0?span:null
 return {rallyShots:measured.reduce((n,r)=>n+r.touches!.length,0),rallySamples:measured.length,durationMs,id:row.match_id,manual:row.manual,date:row.date,tournament:row.tournament||'Private match',round:row.round,players:roster,stats:r.model.stats,impact:analysis.players.map(p=>p.impact),winner:r.model.score.phase==='finished'?r.model.score.winner:null,score:r.model.score.sets.map(s=>`${s.a}–${s.b}`).join('  '),partial:r.partial,video:row.source==='video',deciders:decidingPoints(t.timeline,r.doc.rule),breaks,points:t.timeline.map((p,index)=>({contributors:roster.filter((_,slot)=>analysis.series[index].values[slot] !== (analysis.series[index-1]?.values[slot]??0)).map(x=>x.id),id:p.id,number:p.number,player:p.player===null?null:roster[p.player].id,outcome:p.outcome,shot:p.shot??(p.smash?'smash':'unrecorded'),smash:p.smash,recovery:!!p.smashRecovery,winner:p.winner,breakPoint:p.breakPoint,star:p.star}))}
}
export function aggregate(matches:Match[],ids:string[]){
 const selected=matches.filter(m=>ids.every(id=>m.players.some(p=>p.id===id))&&(ids.length!==2||Math.floor(m.players.findIndex(p=>p.id===ids[0])/2)===Math.floor(m.players.findIndex(p=>p.id===ids[1])/2)))
 const sum={rallyShots:0,rallySamples:0,durationMs:0,durationSamples:0,matches:selected.length,points:0,wins:0,losses:0,inProgress:0,impact:0,winners:0,unforced:0,smashes:0,smashWinners:0,recovered:0,recoveryWinners:0,breakWon:0,breakTotal:0,breakSaved:0,breakFaced:0,starWon:0,starTotal:0,goldenWon:0,goldenTotal:0,starMatches:0,goldenMatches:0,partial:0}
 for(const m of selected){const indexes=ids.map(id=>m.players.findIndex(p=>p.id===id)),team=indexes[0]<2?'a':'b';sum.rallyShots+=m.rallyShots??0;sum.rallySamples+=m.rallySamples??0;if(m.durationMs!=null&&m.durationMs>0){sum.durationMs+=m.durationMs;sum.durationSamples++}sum.points+=m.points.length;sum.partial+=Number(m.partial);if(!m.winner)sum.inProgress++;else if(m.winner===team)sum.wins++;else sum.losses++
 for(const i of indexes){const s=m.stats[i];sum.impact+=m.impact[i];sum.winners+=s.winners;sum.unforced+=s.unforced;sum.smashes+=s.smashes;sum.smashWinners+=s.smashWinners;sum.recovered+=s.smashRecoveredByRival;sum.recoveryWinners+=s.smashRecoveryWinners}
 const b=m.breaks[team];sum.breakWon+=b.won;sum.breakTotal+=b.total;sum.breakSaved+=b.saved;sum.breakFaced+=b.faced
 for(const d of m.deciders){if(d.rule==='star-point'){sum.starMatches++;sum.starTotal+=d.total;sum.starWon+=d[team]}else{sum.goldenMatches++;sum.goldenTotal+=d.total;sum.goldenWon+=d[team]}}
 }
 return sum
}
export type Summary=ReturnType<typeof aggregate>
export const pairKey=(ids:string[])=>[...ids].sort().join('~')
