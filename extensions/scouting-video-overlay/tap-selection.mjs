// Only adjacent, opposing hitters can provide a safe suggestion.
export function previousTapOpponent(pending,player){
 const taps=pending?.touches??[],last=taps.at(-1),previous=taps.at(-2);
 if(last?.player!==player||!Number.isInteger(previous?.player)||previous.player<0||previous.player>3||Math.floor(previous.player/2)===Math.floor(player/2))return undefined;
 return previous.player;
}
