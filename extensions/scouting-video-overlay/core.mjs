import {match} from './match.mjs';
export const fresh = () => ({version:1,label:'',connection:null,pending:null,rallies:[],cancelled:[]});
export function pageReference(value){
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol))throw Error('Open a match video on an HTTP or HTTPS page first.');
  return `${url.origin}${url.pathname}`;
}
export function sameMedia(a,b){
  return !!a && !!b && ['tabId','documentId','videoId','mediaId'].every(k=>a[k]===b[k]);
}
export function usable(s){
  if(!s||!Number.isFinite(s.time)||s.time<0||s.readyState<2||s.seeking)throw Error('Wait for the video to load and finish seeking.');
}
export function startRally(s,label,id){
  usable(s);
  if(s.paused||s.ended)throw Error('Play the video before starting the rally.');
  return {id,label,start:s};
}
export function finishRally(pending,end){
  if(!pending)throw Error('Start a rally first.');
  usable(end);
  if(!sameMedia(pending.start,end))throw Error('The video changed. Cancel this rally and reconnect; its start remains saved.');
  if(pending.start.seekEpoch!==end.seekEpoch||end.time<pending.start.time)throw Error('The video was moved during this rally. Cancel it and start again at the first serve.');
  return {...pending,end,videoSeconds:end.time-pending.start.time,wallSeconds:Math.max(0,(Date.parse(end.at)-Date.parse(pending.start.at))/1000)};
}
export function replayTarget(rally,current,leadIn=3){
  usable(current);
  if(!sameMedia(rally.start,current))throw Error('This bookmark belongs to another playback session. Its timestamps are still available in the export.');
  const range=current.seekable.find(([a,b])=>rally.start.time>=a&&rally.start.time<b);
  if(!range)throw Error('This rally is outside the available replay window. It may have expired from the live buffer.');
  return Math.max(range[0],rally.start.time-leadIn);
}
export function exported(state){
  return {format:'padel-nachos-video-bookmarks',version:1,exportedAt:new Date().toISOString(),clock:'video currentTime in seconds; live and replay timelines may differ',label:state.label,setup:state.setup,selectedMatch:state.selectedMatch,scoutingTime:state.scoutingTime?{seconds:state.scoutingTime.seconds,paused:state.scoutingTime.paused}:null,summary:match(state),savedSessions:state.sessions??{},rallies:state.rallies,pending:state.pending,cancelled:state.cancelled};
}
