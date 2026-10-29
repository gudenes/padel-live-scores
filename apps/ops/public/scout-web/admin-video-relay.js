// Runs only on the admin origin. Exposes media control, never extension scouting storage.
(()=>{
 const channel='pn-admin-video-v1';
 window.addEventListener('message',event=>{
  const m=event.data;
  if(event.source!==window||event.origin!==location.origin||location.origin!=='https://admin.padelnachos.com'||m?.channel!==channel||m.direction!=='request'||typeof m.id!=='string'||m.id.length>100||!['connect','sample','seek','playback','speed','disconnect'].includes(m.action))return;
  chrome.runtime.sendMessage({type:'admin-video',action:m.action,url:m.url,token:m.token,time:m.time,paused:m.paused,rate:m.rate}).then(result=>window.postMessage({channel,direction:'response',id:m.id,...result},location.origin),()=>window.postMessage({channel,direction:'response',id:m.id,ok:false,error:'Scout was updated or disconnected. Reload admin and connect again.'},location.origin));
 });
})();
