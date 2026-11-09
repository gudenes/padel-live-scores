export type PlayWindow={start:number;end:number};
/** Source-video seconds; merge overlaps so buffered points cannot loop backwards. */
export function pointPlaybackWindows(points:{start:number|null;end:number|null}[],duration=0):PlayWindow[]{
 const windows=points.flatMap(p=>p.start!==null&&p.end!==null&&Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start&&p.end>0&&(duration<=0||p.start<duration)?[{start:Math.max(0,p.start-1),end:Math.min(duration>0?duration:Infinity,p.end+1.5)}]:[]).sort((a,b)=>a.start-b.start);
 const merged:PlayWindow[]=[];
 for(const w of windows){const last=merged[merged.length-1];if(last&&w.start<=last.end)last.end=Math.max(last.end,w.end);else merged.push({...w});}
 return merged;
}
/** null = keep playing; number = skip forward; 'end' = stop after final point. */
export function nextPointPlayback(time:number,windows:PlayWindow[]):number|'end'|null{
 if(!windows.length)return null;
 for(const w of windows){if(time<w.start)return w.start;if(time<w.end)return null;}
 return 'end';
}

/** Total retained time at 1×; clamp and union to avoid double counting. */
export function playbackSavings(windows:PlayWindow[],duration:number){
 if(!Number.isFinite(duration)||duration<=0)return null;
 const sorted=windows.filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start).map(w=>({start:Math.max(0,w.start),end:Math.min(duration,w.end)})).filter(w=>w.end>w.start).sort((a,b)=>a.start-b.start);
 if(!sorted.length)return null;
 let retained=0,end=0;
 for(const w of sorted){retained+=Math.max(0,w.end-Math.max(end,w.start));end=Math.max(end,w.end);}
 const saved=Math.max(0,duration-retained);
 return {retained,saved,percent:Math.round(saved/duration*100)};
}
