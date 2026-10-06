import {validateVideoState} from './server-model.mjs';
import {match} from './match.mjs';
// Publish only computed completed-match observations, never operator identity or raw video records.
export function publicReport(row){
 if(!row)return null;
 const document=validateVideoState(row.document),m=match(document);
 if(m.score.phase!=='finished')return null;
 const seed=document.setup.startingScore;
 return {sets:m.score.sets,partial:!!seed,points:m.points,players:row.players.map((p,i)=>({id:p.id,name:p.name,stats:m.stats[i]})),pairs:m.tracking.pairs,service:m.tracking.service,updatedAt:row.updated_at};
}
