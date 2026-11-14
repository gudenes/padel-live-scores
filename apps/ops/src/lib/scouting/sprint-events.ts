import {effortSummary,type MotionSample,type Sprint} from './movement-efforts';
export type SprintEvent=Sprint&{pointId:string;playerKey:string;playerName:string};
export function sprintEvents(motion:Record<string,MotionSample[]>|undefined,players:{key:string;name:string;shortName?:string}[],points:{id:string;start:number|null;end:number|null}[]):SprintEvent[]{
 if(!motion)return [];
 return players.flatMap(player=>points.flatMap(point=>{
  if(point.start===null||point.end===null||point.end<=point.start)return [];
  return effortSummary(motion[player.key]??[],[{start:point.start,end:point.end}]).sprints.map(s=>({...s,pointId:point.id,playerKey:player.key,playerName:player.shortName??player.name}));
 })).sort((a,b)=>a.start-b.start);
}
