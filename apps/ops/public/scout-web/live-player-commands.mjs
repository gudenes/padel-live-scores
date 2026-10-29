import {sameMedia} from './core.mjs';
// Requests to YouTube, never an assertion that its live DVR contains the target.
export function seekLiveCommand(state,bridge,message){
 if(state.pending)throw Error('Finish or cancel the rally before moving the video.');
 const current=bridge.snapshot();if(current.seeking)throw Error('Wait for the video to finish seeking.');
 let target;
 if(message.type==='skip'){
  if(![-30,-10,-5,5,10,30,90].includes(message.seconds))throw Error('Invalid skip.');
  target=current.time+message.seconds;
 }else if(message.type==='replay'){
  const rally=state.rallies.find(r=>r.id===message.id);
  if(!rally||!(sameMedia(rally.start,current)||canRestartLiveMedia(rally.start,current)))throw Error('This point belongs to a different video. Reconnect its original video to replay.');
  if(message.position!==undefined&&!['start','end'].includes(message.position))throw Error('Invalid point position.');
  if(message.position==='end'){if(!Number.isFinite(rally.end?.time))throw Error('This point has no end timestamp.');target=rally.end.time;}else target=rally.start.time-3;
 }else throw Error('Invalid video command.');
 return bridge.seek(Math.max(0,target));
}

// Explicit restart/replay can cross a reload boundary for the same YouTube video; scoring remains session-strict.
export function canRestartLiveMedia(start,current){return !!start&&!!current&&typeof current.videoId==='string'&&current.videoId.length>0&&start.videoId===current.videoId&&start.mediaId==='youtube:'+current.videoId&&current.mediaId===start.mediaId;}
