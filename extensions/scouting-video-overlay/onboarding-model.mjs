// Left/right is relative to the player facing the net, not the viewer.
export function preferredSide(value){const s=String(value??'').trim().toLowerCase();return ['left','izquierda','izquierdo','reves','revés','backhand'].includes(s)?'left':['right','derecha','derecho','drive','forehand'].includes(s)?'right':null;}
export function suggestedCourt(players=[]){
 const unresolved=[];
 const pair=(base,far)=>{const sides=[preferredSide(players[base]?.side),preferredSide(players[base+1]?.side)];if(!sides[0]||!sides[1]||sides[0]===sides[1]){unresolved.push(base/2);return [base,base+1];}const left=sides[0]==='left'?base:base+1,right=left^1;return far?[right,left]:[left,right];};
 return {order:[...pair(0,true),...pair(2,false)],unresolved};
}
export function courtSetup(order){
 if(!Array.isArray(order)||order.length!==4||new Set(order).size!==4||order.some(p=>!Number.isInteger(p)||p<0||p>3)||Math.floor(order[0]/2)!==Math.floor(order[1]/2)||Math.floor(order[2]/2)!==Math.floor(order[3]/2))throw Error('Arrange both pairs on opposite ends.');
 return {near:order[2]<2?'a':'b',positions:{a:order.filter(p=>p<2)[0]===1,b:order.filter(p=>p>=2)[0]===3}};
}
export function localDayWindow(now=new Date()){
 const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()),end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
 return {date:[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-'),start:start.toISOString(),end:end.toISOString()};
}
export function needsServerConfirmation(state,model){return !!model.setServers||state.setup?.otherServerUnknown===true&&Math.floor(model.server/2)!==Math.floor(state.setup.firstServer/2);}
