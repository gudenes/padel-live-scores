// Heartbeats measure operator time, never video time. Long gaps are breaks.
export function scoutingTime(previous,now,mode='tick'){
 const clock={seconds:previous?.seconds??0,paused:previous?.paused??false};
 const delta=(now-(previous?.lastAt??now))/1000;
 if(!clock.paused&&delta>0&&delta<=30)clock.seconds+=delta;
 if(mode==='pause')clock.paused=true;
 if(mode==='resume')clock.paused=false;
 if(!clock.paused&&mode!=='suspend')clock.lastAt=now;
 return clock;
}
