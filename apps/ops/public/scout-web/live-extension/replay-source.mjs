// Preserve only a public YouTube video identity, never arbitrary tab parameters.
export function replaySource(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;let id='';
 if(u.hostname==='youtu.be')id=u.pathname.slice(1);
 if(['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(u.hostname))id=u.searchParams.get('v')||u.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/)?.[1]||'';
 return /^[\w-]{11}$/.test(id)?`https://www.youtube.com/watch?v=${id}`:null;
 }catch{return null}
}

// Keep a public source-page address separately from embeddable replay sources.
export function videoPageUrl(value){
 const youtube=replaySource(value);if(youtube)return youtube;
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)return null;
 if(!['redbull.tv','www.redbull.tv'].includes(url.hostname)||!url.pathname.includes('/page/'))return null;
 url.search='';url.hash='';return url.href;
 }catch{return null}
}
export function savedVideoUrl(session){
 return videoPageUrl(session?.setup?.videoPageUrl)||videoPageUrl(session?.setup?.videoSourceUrl)||videoPageUrl(session?.selectedMatch?.videoUrl);
}
