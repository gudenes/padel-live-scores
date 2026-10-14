// Preserve only a public YouTube video identity, never arbitrary tab parameters.
export function replaySource(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;let id='';
 if(u.hostname==='youtu.be')id=u.pathname.slice(1);
 if(['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(u.hostname))id=u.searchParams.get('v')||u.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/)?.[1]||'';
 return /^[\w-]{11}$/.test(id)?`https://www.youtube.com/watch?v=${id}`:null;
 }catch{return null}
}
