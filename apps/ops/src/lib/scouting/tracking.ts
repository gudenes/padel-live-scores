import {apply,isStarPoint,type MatchState,type TeamId} from './scoring'
import type {Event,Player} from './model'
const player=(s:MatchState):Player=>([0,2,1,3] as const)[s.servingPlayer]
export const gameEnded=(a:MatchState,b:MatchState)=>a.sets.some((s,i)=>s.a!==b.sets[i]?.a||s.b!==b.sets[i]?.b)
export const setEnded=(a:MatchState,b:MatchState)=>b.sets.length>a.sets.length||b.phase==='finished'
export function pressure(s:MatchState){
  const next={a:apply(s,{kind:'point_for',team:'a'}),b:apply(s,{kind:'point_for',team:'b'})}
  const receiver:TeamId=s.servingTeam==='a'?'b':'a'
  return {breakPoint:s.phase==='playing'&&gameEnded(s,next[receiver])?receiver:null,star:isStarPoint(s),setPoint:{a:setEnded(s,next.a),b:setEnded(s,next.b)},matchPoint:{a:next.a.phase==='finished',b:next.b.phase==='finished'}}
}
export interface TimedGame {set:number;game:number;server:Player|null;startedAt:string|null;endedAt:string;durationMs:number|null;winner:TeamId;tieBreak:boolean;partial:boolean}
export interface TimelinePoint {id:string;at:string;number:number;winner:TeamId;server:Player;player:Player|null;outcome:string;smash:boolean;lead:number;before:MatchState;after:MatchState;star:boolean;breakPoint:TeamId|null;breakConverted:boolean;setPoint:{a:boolean;b:boolean};matchPoint:{a:boolean;b:boolean};rallyStartedAt:string|null;durationMs:number|null;firstFaultAt:string|null}
export interface Rally {server:Player;startedAt:string;firstFaultAt:string|null}
export interface CompletedRally extends Rally {endedAt:string;durationMs:number;doubleFault:boolean;winner:TeamId}
export interface ServiceTurn {player:Player;startedAt:string|null;endedAt:string;durationMs:number|null}
const duration=(start:string|null,end:string)=>start===null?null:Math.max(0,Date.parse(end)-Date.parse(start))
export function createTracking(){
  const pair=()=>({breakPoints:0,breaks:0,breakPointsFaced:0,breakPointsSaved:0,holds:0,starPoints:0,starPointsWon:0,setPoints:0,setPointsWon:0,matchPoints:0,matchPointsWon:0})
  const data={timeline:[] as TimelinePoint[],rally:null as Rally|null,rallies:[] as CompletedRally[],rallyMode:false,startedAt:null as string|null,scope:null as 'match'|'observation'|null,endedAt:null as string|null,gameStartedAt:null as string|null,serviceStartedAt:null as string|null,gamePartial:false,gameServer:null as Player|null,pairs:{a:pair(),b:pair()},service:Array.from({length:4},()=>({points:0,won:0,firstFaults:0,doubleFaults:0})),games:[] as TimedGame[],turns:[] as ServiceTurn[]}
  let hasPlay=false,nextService=false
  function closeTurn(s:MatchState,at:string){data.turns.push({player:player(s),startedAt:data.serviceStartedAt,endedAt:at,durationMs:duration(data.serviceStartedAt,at)});data.serviceStartedAt=null}
  return {data,handle(e:Event,before:MatchState,after:MatchState,winner?:TeamId){
    if(data.rally&&['start','game_start','score'].includes(e.kind))throw Error('Finish the rally or undo its start before changing the scoreboard.')
    if(e.kind==='rally_start'){
      if(data.rally)throw Error('A rally is already in progress.')
      if(!data.startedAt){data.startedAt=e.at;data.scope=hasPlay?'observation':'match'}
      if(!data.gameStartedAt&&!data.gamePartial&&before.currentGame.a===0&&before.currentGame.b===0){data.gameStartedAt=e.at;data.gameServer=player(before)}
      if(!data.serviceStartedAt||nextService){data.serviceStartedAt=e.at;nextService=false}
      data.rally={server:player(before),startedAt:e.at,firstFaultAt:null};data.rallyMode=true;hasPlay=true;return
    }
    if(e.kind==='first_fault'){
      if(!data.rally)throw Error('Start the rally before recording a serve fault.')
      if(data.rally.firstFaultAt)throw Error('First fault already recorded. Use Double fault for the second fault.')
      data.rally.firstFaultAt=e.at;return
    }
    if(e.kind==='double_fault'&&(!data.rally||!data.rally.firstFaultAt))throw Error('Record the first-serve fault before the double fault.')
    if(data.rallyMode&&!data.rally&&(e.kind==='point'||e.kind==='smash'))throw Error('Start the next rally before recording its outcome.')
    if(e.kind==='start'){
      if(data.startedAt)throw Error('The session clock has already started.')
      if(e.scope==='match'&&hasPlay)throw Error('Play has already been recorded. Start an observation clock instead.')
      data.startedAt=e.at;data.scope=e.scope
      if(e.scope==='match'){data.gameStartedAt=e.at;data.serviceStartedAt=e.at;data.gameServer=player(before)}
      else data.gamePartial=true
      return
    }
    if(e.kind==='game_start'){
      if(!data.startedAt)throw Error('Start the session clock first.')
      if(data.gameStartedAt||data.gamePartial||before.currentGame.a!==0||before.currentGame.b!==0)throw Error('This game has already started. Its full duration is unknown.')
      data.gameStartedAt=e.at;data.serviceStartedAt=e.at;data.gameServer=player(before);return
    }
    if(e.kind==='score'){
      hasPlay=true;data.gameStartedAt=null;data.serviceStartedAt=null;data.gameServer=null
      data.gamePartial=after.currentGame.a!==0||after.currentGame.b!==0
      data.endedAt=null;return
    }
    if(e.kind==='server'&&player(before)!==player(after)){
      // Correct only the active rally; completed points keep their recorded server.
      // Its observed first serve and any first fault still belong to this rally.
      if(data.rally){
        if(data.serviceStartedAt&&data.serviceStartedAt<data.rally.startedAt)closeTurn(before,data.rally.startedAt)
        data.rally.server=player(after)
        data.serviceStartedAt=data.rally.startedAt;nextService=false
      }else{
        // Between rallies, the replacement's first-serve time is not yet known.
        data.serviceStartedAt=null
      }
      data.gameServer=player(after);return
    }
    if(e.kind==='smash'){hasPlay=true;if(!data.gameStartedAt)data.gamePartial=true;return}
    if(!winner)return
    const completedRally=data.rally
    if(data.rally){
      const r=data.rally
      data.rallies.push({...r,endedAt:e.at,durationMs:duration(r.startedAt,e.at)!,doubleFault:e.kind==='double_fault',winner})
      if(r.firstFaultAt)data.service[r.server].firstFaults++
      if(e.kind==='double_fault')data.service[r.server].doubleFaults++
      data.rally=null
    }
    hasPlay=true
    if(!data.gameStartedAt)data.gamePartial=true
    const p=pressure(before),serving=before.servingTeam,receiving=serving==='a'?'b':'a'
    data.service[player(before)].points++;if(winner===serving)data.service[player(before)].won++
    if(p.breakPoint){data.pairs[receiving].breakPoints++;data.pairs[serving].breakPointsFaced++;if(winner===serving)data.pairs[serving].breakPointsSaved++}
    if(p.star){for(const team of ['a','b'] as const)data.pairs[team].starPoints++;data.pairs[winner].starPointsWon++}
    for(const team of ['a','b'] as const){if(p.setPoint[team]){data.pairs[team].setPoints++;if(winner===team)data.pairs[team].setPointsWon++}if(p.matchPoint[team]){data.pairs[team].matchPoints++;if(winner===team)data.pairs[team].matchPointsWon++}}
    const ended=gameEnded(before,after)
    data.timeline.push({id:e.id,at:e.at,number:data.timeline.length+1,winner,server:player(before),player:e.kind==='point'?e.player:e.kind==='double_fault'?player(before):null,outcome:e.kind==='point'?e.outcome:e.kind,smash:e.kind==='point'&&e.smash,lead:(data.timeline.at(-1)?.lead??0)+(winner==='a'?1:-1),before,after,star:p.star,breakPoint:p.breakPoint,breakConverted:ended&&before.phase==='playing'&&winner===receiving,setPoint:p.setPoint,matchPoint:p.matchPoint,rallyStartedAt:completedRally?.startedAt??null,durationMs:completedRally?duration(completedRally.startedAt,e.at):null,firstFaultAt:completedRally?.firstFaultAt??null})
    if(ended){
      const set=before.sets.at(-1)!
      data.games.push({set:before.sets.length,game:set.a+set.b+1,server:before.phase==='playing'?(data.gameServer??player(before)):null,startedAt:data.gameStartedAt,endedAt:e.at,durationMs:duration(data.gameStartedAt,e.at),winner,tieBreak:before.phase!=='playing',partial:data.gamePartial})
      if(before.phase==='playing'){if(winner===receiving)data.pairs[winner].breaks++;else data.pairs[winner].holds++}
      closeTurn(before,e.at);data.gameStartedAt=null;data.gameServer=null;data.gamePartial=false
    }else if(player(before)!==player(after)){
      closeTurn(before,e.at)
      // Automatic tie-break rotations timestamp the turn boundary, including the interval before serving.
      data.serviceStartedAt=e.at;nextService=true
    }
    if(after.phase==='finished')data.endedAt=e.at
  }}
}
export function formatDuration(ms:number|null){if(ms===null)return '—';const s=Math.max(0,Math.floor(ms/1000));return `${Math.floor(s/3600)?Math.floor(s/3600)+':':''}${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
