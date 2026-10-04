import {getDeuceRule,type MatchState,type TeamId} from './scoring'
export function scoreLabel(state:MatchState,team:TeamId):string{
 const point=state.currentGame[team]
 if(state.phase!=='playing'||getDeuceRule(state.config)!=='star-point')return String(point)
 const stage=Math.min((state.advantageReturns??0)+1,3)
 if(point==='Adv')return `Adv${Math.min(stage,2)}`
 if(state.currentGame.a===40&&state.currentGame.b===40)return stage===3?'SP':`D${stage}`
 return String(point)
}
