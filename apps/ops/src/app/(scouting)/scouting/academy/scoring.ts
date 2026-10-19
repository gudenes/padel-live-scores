export type Call={player:number;outcome:string;shot:string}
export function compareCall(call:Call,reference:Call){
 const player=call.player===reference.player,outcome=call.outcome===reference.outcome,shot=call.shot===reference.shot
 return {player,outcome,shot,correct:Number(player)+Number(outcome)+Number(shot)}
}
