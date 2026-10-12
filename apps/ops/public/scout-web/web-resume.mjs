// Keep recorded history intact. Only an active rally needs a new clock identity.
export function webResumeState(document,matchId){
 const state=structuredClone(document);
 state.captureMode='standalone';
 const rebase=value=>{
  if(!value||typeof value!=='object')return;
  if('videoId' in value&&'time' in value){Object.assign(value,{tabId:0,documentId:'standalone:'+matchId,videoId:'standalone',mediaId:'standalone:'+matchId,seekEpoch:0});return;}
  for(const item of Object.values(value))rebase(item);
 };
 rebase(state.pending);
 return state;
}
