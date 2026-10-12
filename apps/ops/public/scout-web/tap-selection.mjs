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
