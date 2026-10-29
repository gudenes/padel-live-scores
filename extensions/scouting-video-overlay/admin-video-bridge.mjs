import {videoProbe} from './probe.mjs';
export function redbullSource(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!['redbull.tv','www.redbull.tv'].includes(u.hostname)||!/^\/[\w-]+\/page\/rrn:content:(?:live-videos|videos):[0-9a-f-]{36}(?:\/|$)/i.test(u.pathname))return null;return u.origin+u.pathname;}catch{return null;}
}
// Only the toolbar gesture grants activeTab access. No Red Bull host permission is requested.
export function adminVideoBridge(api){
 const owner=s=>{if(s.id!==api.runtime.id||s.frameId!==0||!Number.isInteger(s.tab?.id)||!s.documentId||new URL(s.url).origin!=='https://admin.padelnachos.com')throw Error('Open this connection from the admin workspace.');return s.tab.id+':'+s.documentId;};
 const read=async key=>(await api.storage.session.get(key))[key];
 async function probe(tabId,selected,command){
  const results=await api.scripting.executeScript({target:selected?{tabId,documentIds:[selected.documentId]}:{tabId,allFrames:true},func:videoProbe,args:[selected?{...command,videoId:selected.videoId,mediaId:selected.mediaId}:{kind:'list'}]});
  if(!selected)return results.flatMap(r=>(Array.isArray(r.result)?r.result:[]).map(v=>({...v,tabId,documentId:r.documentId,frameId:r.frameId}))).filter(v=>v.visible&&v.readyState>=2&&redbullSource(v.page)).sort((a,b)=>Number(a.paused)-Number(b.paused)||b.area-a.area)[0];
  const r=results.find(r=>r.documentId===selected.documentId)?.result;
  if(!r||Array.isArray(r)||r.videoId!==selected.videoId||r.mediaId!==selected.mediaId)throw Error('The video changed. Finish or cancel the rally, then reconnect.');
  return {...r,tabId,documentId:selected.documentId,frameId:selected.frameId};
 }
 return {
  async designate(tab){if(redbullSource(tab.url))await api.storage.session.set({adminRedbullCandidate:{tabId:tab.id,url:redbullSource(tab.url)}});},
  async handle(m,sender){
   const identity=owner(sender),key='adminVideo:'+identity;
   if(m.action==='connect'){
    const url=redbullSource(m.url),candidate=await read('adminRedbullCandidate');
    if(!url||!candidate||candidate.url!==url)throw Error('Open this Red Bull TV link, start playback and click the Scout toolbar icon. Then return here and connect.');
    const tab=await api.tabs.get(candidate.tabId);if(redbullSource(tab.url)!==url)throw Error('The Red Bull tab changed. Open the saved link and click Scout again.');
    const lease=await read('adminVideoLease:'+tab.id);
    if(lease&&lease.owner!==identity&&Date.now()-lease.at<15000)throw Error('This video is connected to another admin tab. Disconnect it there first.');
    const selected=await probe(tab.id);if(!selected)throw Error('Start the video on Red Bull TV before connecting.');
    const token=crypto.randomUUID();await api.storage.session.set({[key]:{token,url,tabId:tab.id,selected},['adminVideoLease:'+tab.id]:{owner:identity,at:Date.now()}});
    return {token,sample:selected};
   }
   const connection=await read(key);if(!connection||m.token!==connection.token)throw Error('Video disconnected. Connect it again.');
   const leaseKey='adminVideoLease:'+connection.tabId,lease=await read(leaseKey);
   if(lease?.owner!==identity)throw Error('The video connection expired. Reconnect it.');
   if(m.action==='disconnect'){await api.storage.session.remove([key,leaseKey]);return {};}
   if(!['sample','seek','playback','speed'].includes(m.action))throw Error('Unsupported video command.');
   if(m.action==='playback'&&typeof m.paused!=='boolean')throw Error('Invalid playback command.');
   const tab=await api.tabs.get(connection.tabId);if(redbullSource(tab.url)!==connection.url)throw Error('The Red Bull tab navigated away. Reconnect the original video.');
   // Validate identity before any command, including samples used by scoring.
   const current=await probe(connection.tabId,connection.selected,{kind:'sample'});
   const sample=m.action==='sample'?current:await probe(connection.tabId,connection.selected,{kind:m.action,time:m.time,paused:m.paused,rate:m.rate});
   await api.storage.session.set({[leaseKey]:{owner:identity,at:Date.now()}});
   return {sample};
  }
 };
}
