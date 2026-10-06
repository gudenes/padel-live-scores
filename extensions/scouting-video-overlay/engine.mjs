import {validateVideoState,videoPayload} from './server-model.mjs';
import {fresh,startRally,finishRally,replayTarget,pageReference} from './core.mjs';
import {defaults,match,validateSetup,validatePoint} from './match.mjs';
export function engine({read,write,discover,capture,seek,uuid,catalog,playback}){
  // All panels share this queue in the worker, preventing duplicate or lost writes.
  let queue=Promise.resolve();
  return message=>{
    const operation=async()=>{
      const state=(await read())??fresh();
      state.setup??=defaults();
      const save=async()=>{await write(state,{type:message.type});return {state};};
      switch(message.type){
        case 'state':return {state};
        case 'playback':{
          if(!state.connection||!playback)throw Error('Connect a video first.');
          const current=await capture(state.connection);
          await playback(state.connection,current,!current.paused);return {state};
        }
        case 'overlay-layout':{
          const {corner,x,y}=message;
          if(!['near-left','near-right','far-left','far-right'].includes(corner)||![x,y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Invalid overlay position.');
          state.overlayLayout={...state.overlayLayout,[corner]:{x,y}};return save();
        }
        case 'load-tournaments':{
          if(!catalog)throw Error('Admin catalogue is unavailable.');
          const result=await catalog({kind:'tournaments',year:message.year});
          state.catalog={...state.catalog,tournaments:result.tournaments,loadedAt:result.loadedAt};return save();
        }
        case 'load-matches':{
          if(!state.catalog?.tournaments.some(t=>t.id===message.tournamentId))throw Error('Choose a tournament from the catalogue.');
          const result=await catalog({kind:'matches',tournamentId:message.tournamentId});
          state.catalog.matchesByTournament={...state.catalog.matchesByTournament,[message.tournamentId]:result.matches};return save();
        }
        case 'select-match':{
          if(state.pending)throw Error('Finish or cancel the current rally before switching matches.');
          const tournament=state.catalog?.tournaments.find(t=>t.id===message.tournamentId);
          const selected=state.catalog?.matchesByTournament?.[message.tournamentId]?.find(m=>m.id===message.matchId);
          if(!tournament||!selected)throw Error('Choose a match from the selected tournament.');
          if(state.selectedMatch?.id===selected.id)return {state};
          const setup=validateSetup({...defaults(),names:selected.names});
          state.sessions??={};
          state.sessions[state.selectedMatch?.id??'unassigned']={setup:state.setup,label:state.label,rallies:state.rallies,cancelled:state.cancelled,selectedMatch:state.selectedMatch??null};
          const saved=state.sessions[selected.id];
          Object.assign(state,saved??{setup,label:`${tournament.name} · ${selected.round??selected.category??'Match'}`,rallies:[],cancelled:[]});
          state.selectedMatch={...selected,tournamentName:tournament.name};state.connection=null;state.pending=null;return save();
        }
        case 'restore-cloud':{
          if(state.pending)throw Error('Finish or cancel the open rally before loading the server copy.');
          if(!state.selectedMatch||state.selectedMatch.id!==message.matchId)throw Error('Select this match first.');
          if(JSON.stringify(videoPayload(state))!==message.expectedHash)throw Error('Local scouting changed while loading. Your local copy is retained; try again.');
          const restored=validateVideoState(message.document);
          if(restored.pending){restored.cancelled.push({...restored.pending,cancelledAt:new Date().toISOString()});restored.pending=null;}
          Object.assign(state,restored);state.connection=null;return save();
        }
        case 'setup':{
          if(state.pending||state.rallies.some(r=>r.point))throw Error('Match setup is locked after scouting starts.');
          state.setup=validateSetup(message.setup);return save();
        }
        case 'positions':{
          if(state.pending)throw Error('Finish or cancel the rally before moving players.');
          if(!['a','b'].includes(message.pair))throw Error('Choose a pair.');
          state.setup.positions??={a:false,b:false};state.setup.positions[message.pair]=!state.setup.positions[message.pair];return save();
        }
        case 'server':case 'ends':{
          if(state.pending)throw Error('Finish or cancel the rally before changing server or ends.');
          if(!state.selectedMatch||match(state).score.phase==='finished')throw Error('Select an unfinished match.');
          if(message.type==='server'&&(!Number.isInteger(message.player)||message.player<0||message.player>3))throw Error('Choose one of the four players.');
          (state.setup.adjustments??=[]).push({type:message.type,player:message.player,afterId:state.rallies.at(-1)?.id??null,at:new Date().toISOString()});return save();
        }
        case 'skip':{
          if(state.pending)throw Error('Finish or cancel the rally before skipping the video.');
          if(![-30,-10,-5,5,10,30].includes(message.seconds)||!state.connection)throw Error('Connect a video and choose ±5s, ±10s or ±30s.');
          const current=await capture(state.connection);
          if(current.seeking)throw Error('Wait for the video to finish seeking.');
          const range=current.seekable.find(([a,b])=>current.time>=a&&current.time<b);
          if(!range)throw Error('The video has no available seek window.');
          await seek(state.connection,current,Math.max(range[0],Math.min(current.time+message.seconds,range[1]-.01)));return {state};
        }
        case 'prepare':{
          if(!state.pending||!state.connection)throw Error('Start a rally first.');
          if(state.pending.finish)throw Error('Save or cancel the selected outcome first.');
          const point=validatePoint(message,state.pending,match(state).server);
          const end=await capture(state.connection);finishRally(state.pending,end);
          state.pending.finish={end,player:point.player,outcome:point.outcome};return save();
        }
        case 'clear-outcome':{if(state.pending)delete state.pending.finish;return save();}
        case 'score':{
          if(!state.pending?.finish)throw Error('Select the player’s outcome first.');
          const selected=state.pending.finish;
          const point=validatePoint({...message.details,player:selected.player,outcome:selected.outcome},state.pending,match(state).server);
          const rally=finishRally(state.pending,selected.end);
          delete rally.finish;
          state.rallies.push({...rally,point});state.pending=null;return save();
        }
        case 'first-fault':{
          if(!state.pending||!state.connection||state.pending.finish)throw Error('Start a rally before recording a fault.');
          if(state.pending.firstFault)throw Error('First fault already recorded.');
          const snapshot=await capture(state.connection);finishRally(state.pending,snapshot);
          state.pending.firstFault=snapshot;return save();
        }
        case 'double-fault':{
          if(!state.pending||!state.connection||state.pending.finish)throw Error('Start a rally first.');
          const point=validatePoint({player:match(state).server,outcome:'double_fault'},state.pending,match(state).server);
          state.rallies.push({...finishRally(state.pending,await capture(state.connection)),point});state.pending=null;return save();
        }
        case 'smash':{
          if(!state.pending||!state.connection||state.pending.finish)throw Error('Start a rally before counting attempts.');
          if(!Number.isInteger(message.player)||message.player<0||message.player>3)throw Error('Choose a player.');
          const snapshot=await capture(state.connection);finishRally(state.pending,snapshot);
          (state.pending.attempts??=[]).push({player:message.player,snapshot});return save();
        }
        case 'undo':{
          if(state.pending)throw Error('Cancel the open rally before undoing a point.');
          const last=state.rallies.findLast(r=>r.point&&!r.undone);
          if(!last)throw Error('No scored point to undo.');
          last.undone=true;last.undoneAt=new Date().toISOString();return save();
        }
        case 'label':state.label=String(message.label??'').trim().slice(0,160);return save();
        case 'connect':
        case 'reconnect':{
          if(state.pending)throw Error('Finish or cancel the open rally before connecting another video.');
          if(message.type==='reconnect'&&!state.connection)throw Error('Use Connect video in the side panel first.');
          const found=await discover(message.type==='reconnect'?state.connection.tabId:undefined);
          if(!found.videos.length)throw Error('No accessible video found. Start playback, click the extension icon on that tab and reconnect. A player in a different-site iframe may need site-specific support.');
          state.connection={tabId:found.tabId,page:pageReference(found.url),candidates:found.videos,selected:found.videos[0]};
          return save();
        }
        case 'select':{
          if(state.pending)throw Error('Finish or cancel the rally before changing players.');
          const c=state.connection?.candidates.find(v=>v.videoId===message.videoId);
          if(!c)throw Error('Connect to the video first.');
          state.connection.selected=c;return save();
        }
        case 'sample':{
          if(!state.connection)return {state,sample:null};
          return {state,sample:await capture(state.connection)};
        }
        case 'start':{
          if(state.pending)throw Error('A rally is already open.');
          if(!state.selectedMatch)throw Error('Select a tournament and match first.');
          if(match(state).score.phase==='finished')throw Error('The match is finished.');
          if(!state.connection)throw Error('Connect to the video first.');
          if(typeof message.label==='string')state.label=message.label.trim().slice(0,160);
          state.pending=startRally(await capture(state.connection),state.label,uuid());
          return save();
        }
        case 'end':{
          if(!state.pending||!state.connection)throw Error('Start a rally first.');
          state.rallies.push(finishRally(state.pending,await capture(state.connection)));
          state.pending=null;return save();
        }
        case 'cancel':{
          if(state.pending)state.cancelled.push({...state.pending,cancelledAt:new Date().toISOString()});
          state.pending=null;return save();
        }
        case 'replay':{
          if(state.pending)throw Error('Finish or cancel the rally before replaying.');
          const rally=state.rallies.find(r=>r.id===message.id);
          if(!rally||!state.connection)throw Error('Connect to the original video session to replay this rally.');
          const current=await capture(state.connection);
          const time=replayTarget(rally,current);
          await seek(state.connection,current,time);return {state};
        }
        default:throw Error('Unknown video companion action.');
      }
    };
    const result=queue.then(operation);
    queue=result.catch(()=>{});
    return result;
  };
}
