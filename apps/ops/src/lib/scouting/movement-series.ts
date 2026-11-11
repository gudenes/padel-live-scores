/** Derived from observed court positions. Never bridges inference, missing frames or camera cuts. */
export type TrackRow={source_s:number;segment_id:number|null;overlay_visible:boolean;players:Record<string,{court_m?:number[];position_source?:string}>};
export type SpeedSample={time:number;duration:number;speed:number;distance:number;segment:number;zoneSeconds?:number[];heat?:Record<string,number>};
export function movementSeries(rows:TrackRow[],keys:string[]):Record<string,SpeedSample[]>{
 const out=Object.fromEntries(keys.map(k=>[k,[] as SpeedSample[]]));
 for(const key of keys){let anchor:TrackRow|null=null,previous:TrackRow|null=null,zoneSeconds=[0,0,0],heat:Record<string,number>={};
  for(const row of rows){const p=row.players[key],xy=p?.court_m;
   if(!row.overlay_visible||row.segment_id==null||p?.position_source!=='observed'||!xy||xy.length!==2||!xy.every(Number.isFinite)){anchor=null;previous=null;zoneSeconds=[0,0,0];heat={};continue;}
   if(!previous||row.segment_id!==previous.segment_id||row.source_s-previous.source_s>0.15||row.source_s<=previous.source_s){anchor=row;zoneSeconds=[0,0,0];heat={};}
   else {const [px,py]=previous.players[key].court_m!;if(px>=0&&px<=10&&py>=0&&py<=20){const cell=Math.min(9,Math.floor(px))+","+Math.min(19,Math.floor(py));heat[cell]=(heat[cell]??0)+row.source_s-previous.source_s;}const depth=Math.abs(py-10);if(depth<=10)zoneSeconds[depth<5?0:depth<7?1:2]+=row.source_s-previous.source_s;}
   previous=row;if(!anchor){anchor=row;continue;}
   const dt=row.source_s-anchor.source_s;if(dt<0.999)continue;
   const a=anchor.players[key].court_m!,distance=Math.hypot(xy[0]-a[0],xy[1]-a[1]),speed=distance/dt*3.6;
   if(dt<=1.21&&speed<=30)out[key].push({time:row.source_s,duration:dt,speed,distance,segment:row.segment_id,zoneSeconds:[...zoneSeconds],heat:{...heat}});
   anchor=row;zoneSeconds=[0,0,0];heat={};
  }
 }return out;
}
export function speedBands(samples:SpeedSample[]){const bands=[0,0,0,0];for(const s of samples)bands[s.speed<3?0:s.speed<6?1:s.speed<12?2:3]+=s.duration;const total=bands.reduce((a,b)=>a+b,0);return bands.map(seconds=>({seconds,percent:total?seconds/total*100:0}));}
export function intensityBins(samples:SpeedSample[],start:number,end:number){
 const bins=Array.from({length:Math.ceil((end-start)/30)},(_,i)=>({time:start+i*30+15,seconds:0,distance:0,value:null as number|null}));
 for(const s of samples){const i=Math.floor((s.time-start-0.0001)/30);if(bins[i]){bins[i].seconds+=s.duration;bins[i].distance+=s.distance;}}
 return bins.map(b=>({...b,value:b.seconds>=5?b.distance/b.seconds*60:null}));
}
