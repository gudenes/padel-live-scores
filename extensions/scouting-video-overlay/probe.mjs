// Chrome serializes this function into an isolated world. Keep it self-contained.
export async function videoProbe(command={kind:'list'}){
  const key='__padelNachosVideoCompanionV1';
  let state=window[key];
  if(!state){
    state={videos:new WeakMap()};
    Object.defineProperty(window,key,{value:state});
  }
  const elements=[];
  function collect(root){
    for(const el of root.querySelectorAll('*')){
      if(el.tagName==='VIDEO')elements.push(el);
      if(el.shadowRoot)collect(el.shadowRoot);
    }
  }
  collect(document);
  function meta(video){
    let m=state.videos.get(video);
    if(!m){
      m={videoId:crypto.randomUUID(),mediaId:crypto.randomUUID(),source:video.currentSrc,seekEpoch:0};
      state.videos.set(video,m);
      video.addEventListener('seeking',()=>m.seekEpoch++);
      video.addEventListener('emptied',()=>{m.mediaId=crypto.randomUUID();});
      video.addEventListener('loadedmetadata',()=>{m.mediaId=crypto.randomUUID();});
    }
    if(m.source!==video.currentSrc){m.source=video.currentSrc;m.mediaId=crypto.randomUUID();}
    return m;
  }
  function snapshot(video){
    const m=meta(video),rect=video.getBoundingClientRect();
    const u=new URL(location.href);
    return {videoId:m.videoId,mediaId:m.mediaId,seekEpoch:m.seekEpoch,time:video.currentTime,at:new Date().toISOString(),paused:video.paused,ended:video.ended,seeking:video.seeking,readyState:video.readyState,rate:video.playbackRate,duration:Number.isFinite(video.duration)?video.duration:null,seekable:Array.from({length:video.seekable.length},(_,i)=>[video.seekable.start(i),video.seekable.end(i)]),page:`${u.origin}${u.pathname}`,area:Math.max(0,rect.width)*Math.max(0,rect.height),visible:rect.width>0&&rect.height>0&&getComputedStyle(video).visibility!=='hidden'};
  }
  if(command.kind==='list')return elements.map(snapshot);
  const video=elements.find(v=>meta(v).videoId===command.videoId);
  if(!video)throw Error('The selected player disappeared. Reconnect to the video.');
  if(command.kind==='playback'){
    if(meta(video).mediaId!==command.mediaId)throw Error('The video source changed. Reconnect first.');
    if(command.paused)video.pause();else await video.play();
  }
  if(command.kind==='seek'){
    const current=snapshot(video);
    if(current.mediaId!==command.mediaId)throw Error('The video source changed. Reconnect before replaying.');
    if(!Number.isFinite(command.time)||!current.seekable.some(([a,b])=>command.time>=a&&command.time<b))throw Error('This timestamp is no longer in the replay window.');
    video.currentTime=command.time;
    // Leave playback paused/playing as the viewer chose; do not force autoplay.
  }
  return snapshot(video);
}
