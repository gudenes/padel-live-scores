/** Scouting clock → uploaded video. Segment changes describe edits between rallies. */
export type ScoutingAlignment={version:1;offsetSeconds:number;method:string;segments?:{sourceFrom:number;offsetSeconds:number}[]};
export function scoutToVideo(time:number,fallbackOffset:number,alignment?:ScoutingAlignment){
 let offset=alignment?.offsetSeconds??fallbackOffset;
 for(const segment of alignment?.segments??[]){if(time<segment.sourceFrom)break;offset=segment.offsetSeconds;}
 return time-offset;
}
export function videoToScout(time:number,fallbackOffset:number,alignment?:ScoutingAlignment){
 let offset=alignment?.offsetSeconds??fallbackOffset;
 for(const segment of alignment?.segments??[]){
  if(time<segment.sourceFrom-segment.offsetSeconds)return Math.min(time+offset,segment.sourceFrom);
  offset=segment.offsetSeconds;
 }
 return time+offset;
}
export function validScoutingAlignment(a:ScoutingAlignment){
 if(!a||a.version!==1||!Number.isFinite(a.offsetSeconds)||typeof a.method!=='string'||!a.method.trim())return false;
 if(a.segments===undefined)return true;
 if(!Array.isArray(a.segments)||a.segments.length>500)return false;
 let previousSource=-Infinity,previousOffset=a.offsetSeconds;
 for(const s of a.segments){
  // Only forward jumps in video time are supported; do not create ambiguous inverse mappings.
  if(!s||!Number.isFinite(s.sourceFrom)||s.sourceFrom<0||s.sourceFrom<=previousSource||!Number.isFinite(s.offsetSeconds)||s.offsetSeconds>previousOffset)return false;
  previousSource=s.sourceFrom;previousOffset=s.offsetSeconds;
 }
 return true;
}
