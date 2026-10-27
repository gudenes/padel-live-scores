// Camera-facing left/right positions, not measured ball trajectories.
export function touchDirections(touches=[]){
 return touches.map((touch,i)=>{
  const next=touches[i+1],from=touch.order.indexOf(touch.player),to=next?touch.order.indexOf(next.player):-1;
  const valid=next&&new Set(touch.order).size===4&&touch.order.every((p,j)=>p===next.order[j])&&Math.floor(from/2)!==Math.floor(to/2)&&((touch.player<2)!==(next.player<2));
  return {player:touch.player,direction:valid?(from%2===to%2?'down-the-line':'cross-court'):'unknown',inferred:true};
 });
}
export function touchInsights(rallies=[]){
 const recorded=rallies.filter(r=>r.point&&!r.undone&&r.touches?.length);
 const players=Array.from({length:4},()=>({shots:0,crossCourt:0,downTheLine:0,unknown:0}));
 for(const r of recorded)for(const t of touchDirections(r.touches)){const p=players[t.player];p.shots++;p[t.direction==='cross-court'?'crossCourt':t.direction==='down-the-line'?'downTheLine':'unknown']++;}
 return {trackedRallies:recorded.length,shots:players.reduce((n,p)=>n+p.shots,0),players};
}
