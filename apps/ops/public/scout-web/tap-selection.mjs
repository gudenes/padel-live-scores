// Only adjacent, opposing hitters can provide a safe suggestion.
export function previousTapOpponent(pending,player){
 const taps=pending?.touches??[],last=taps.at(-1),previous=taps.at(-2);
 if(last?.player!==player||!Number.isInteger(previous?.player)||previous.player<0||previous.player>3||Math.floor(previous.player/2)===Math.floor(player/2))return undefined;
 return previous.player;
}

// A single opposing tap can represent the return; never guess an unknown server.
export function firstTapReturn(pending,player,outcome,server,serverConfirmed=true){
 return serverConfirmed&&outcome==='unforced'&&Number.isInteger(server)&&server>=0&&server<4
  &&pending?.touches?.length===1&&pending.touches[0].player===player
  &&Math.floor(player/2)!==Math.floor(server/2);
}

// Suggest only from the final alternating teammate → opponent → finisher sequence.
export function suggestedAssist(pending,player,outcome,server,serverConfirmed=false){
 const taps=pending?.touches??[],[partner,opponent,last]=taps.slice(-3);
 // Expert capture starts with the return: the confirmed serve is implicit.
 if(outcome==='winner'&&serverConfirmed&&Number.isInteger(server)&&server>=0&&server<4
  &&taps.length===2&&player===(server^1)&&taps[1].player===player
  &&Number.isInteger(taps[0].player)&&taps[0].player>=0&&taps[0].player<4
  &&Math.floor(taps[0].player/2)!==Math.floor(server/2))return server;
 return outcome==='winner'&&last?.player===player&&partner?.player===(player^1)
  &&Number.isInteger(opponent?.player)&&opponent.player>=0&&opponent.player<4
  &&Math.floor(opponent.player/2)!==Math.floor(player/2)?partner.player:undefined;
}
// A recorded attempt must be the final touch, never merely this player's last smash.
export function finalSmashAttempt(pending,player){
 const taps=pending?.touches??[],attempts=pending?.attempts??[];
 return attempts.findLastIndex((a,index)=>index===attempts.length-1&&a.player===player&&(a.touchIndex!==undefined
  ?a.touchIndex===taps.length-1&&taps.at(-1)?.player===player
  :!taps.length||a.snapshot?.time>taps.at(-1)?.snapshot?.time));
}
