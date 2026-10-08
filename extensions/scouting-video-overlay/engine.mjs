import {validateVideoState,videoPayload} from './server-model.mjs';
import {manualInput} from './manual-match.mjs';
import {validateStartingScore} from './starting-score.mjs';
import {fresh,startRally,finishRally,replayTarget,pageReference,usable,sameMedia} from './core.mjs';
import {defaults,match,validateSetup,validatePoint,validateSmashType,courtPlayers} from './match.mjs';
export function engine({read,write,discover,capture,seek,uuid,catalog,playback,setRate}){
  // All panels share this queue in the worker, preventing duplicate or lost writes.
  let queue=Promise.resolve();
  return message=>{
    const operation=async()=>{
      const state=(await read())??fresh();
      state.setup??=defaults();
      const undoable=new Set(['restart-rally','var-review','starting-score','setup','positions','server','ends','prepare','clear-outcome','score','first-fault','double-fault','smash','touch','undo','label','start','end','cancel']);
      const before=undoable.has(message.type)?structuredClone({setup:state.setup,label:state.label,pending:state.pending,rallies:state.rallies,cancelled:state.cancelled}):null;
      const save=async(context={})=>{
        if(before){const changes=(old,next)=>old.flatMap((value,index)=>JSON.stringify(value)!==JSON.stringify(next[index])?[{index,value}]:[]);(state.history??=[]).push({type:message.type,setup:before.setup,label:before.label,pending:before.pending,ralliesLength:before.rallies.length,cancelledLength:before.cancelled.length,rallies:changes(before.rallies,state.rallies),cancelled:changes(before.cancelled,state.cancelled)});state.history=state.history.slice(-50);}
        await write(state,{type:message.type,...context});return {state};
      };
      switch(message.type){
        case 'state':return {state};
        case 'undo-last':{
          const last=state.history?.pop();
          if(!last){if(state.pending)throw Error('No recent action to undo. Cancel the open rally first.');const r=state.rallies.findLast(r=>r.point&&!r.undone);if(!r)throw Error('No action to undo.');r.undone=true;r.undoneAt=new Date().toISOString();return save();}
          Object.assign(state,{setup:last.setup,label:last.label,pending:last.pending});
          for(const key of ['rallies','cancelled']){state[key].length=last[key+'Length'];for(const change of last[key])state[key][change.index]=change.value;}
          return save();
        }
        case 'speed':case 'cycle-speed':{
          if(!state.connection||!setRate)throw Error('Connect a video first.');
          if(state.pending)throw Error('Playback speed can only change between rallies.');
          const current=await capture(state.connection);usable(current);
          const rate=message.type==='cycle-speed'?({1:2,2:4,4:1}[current.rate]??1):message.rate;
          if(![1,2,4].includes(rate))throw Error('Choose 1×, 2× or 4×.');
          const updated=await setRate(state.connection,current,rate);
          if(updated.rate!==rate)throw Error('This player could not apply that speed.');
          return {state,sample:updated};
        }
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
        case 'clear-catalog':{
          state.catalog={tournaments:[],matchesByTournament:{}};return save();
        }
        case 'leave-match':{
          if(state.pending)throw Error('Finish or cancel the current rally before switching matches.');
          if(state.selectedMatch){
            state.sessions??={};
            state.sessions[state.selectedMatch.id]={setup:state.setup,label:state.label,rallies:state.rallies,cancelled:state.cancelled,selectedMatch:state.selectedMatch,history:state.history??[]};
          }
          Object.assign(state,{setup:defaults(),label:'',rallies:[],cancelled:[],selectedMatch:null,connection:null,pending:null,history:[]});return save();
        }
        case 'load-tournaments':{
          if(!catalog)throw Error('Admin catalogue is unavailable.');
          const result=await catalog({kind:'tournaments',year:message.year});
          state.catalog={...state.catalog,tournaments:result.tournaments,loadedAt:result.loadedAt};return save();
        }
        case 'load-matches':{
          if(!state.catalog?.tournaments.some(t=>t.id===message.tournamentId))throw Error('Choose a tournament from the catalogue.');
          const result=await catalog({kind:'matches',tournamentId:message.tournamentId});
          state.catalog.matchesByTournament={...state.catalog.matchesByTournament,[message.tournamentId]:result.matches};
          const active=result.matches.find(m=>m.id===state.selectedMatch?.id);
          if(active&&JSON.stringify(active.playerIds)===JSON.stringify(state.selectedMatch.playerIds)&&JSON.stringify(active.names)===JSON.stringify(state.selectedMatch.names))state.selectedMatch.players=active.players;
          return save();
        }
        case 'search-players':return catalog({kind:'search-players',query:String(message.query??'').slice(0,80)});
        case 'manual-matches':{
          const result=await catalog({kind:'manual-matches'});state.manualMatches=result.matches;return save();
        }
        case 'create-manual':{
          if(state.pending)throw Error('Save or cancel the current rally before creating another match.');
          const input=manualInput(message.input);
          const draft=state.manualDraft;
          state.manualDraft={...input,id:draft&&JSON.stringify(manualInput(draft))===JSON.stringify(input)?draft.id:uuid()};
          // Keep the creation ID on disk before sending: retrying a lost response is safe.
          await write(state,{type:'manual-draft'});
          const result=await catalog({kind:'create-manual',input:state.manualDraft});
          const selected=result.match;if(!selected?.id||selected.kind!=='manual')throw Error('The private match was not confirmed. Retry safely.');
          state.manualMatches=[selected,...(state.manualMatches??[]).filter(m=>m.id!==selected.id)];
          state.sessions??={};
          if(state.selectedMatch)state.sessions[state.selectedMatch.id]={setup:state.setup,label:state.label,rallies:state.rallies,cancelled:state.cancelled,selectedMatch:state.selectedMatch,history:state.history??[]};
          Object.assign(state,{setup:validateSetup({...defaults(),names:selected.names}),label:selected.tournamentName,rallies:[],cancelled:[],history:[],selectedMatch:selected,connection:null,pending:null,manualDraft:null});return save();
        }
        case 'resume-session':{
          if(state.pending)throw Error('Save or cancel the current rally before switching matches.');
          if(state.selectedMatch?.id===message.matchId)return {state};
          const saved=state.sessions?.[message.matchId],selected=saved?.selectedMatch??state.manualMatches?.find(m=>m.id===message.matchId);
          if(!selected)throw Error('This saved session is unavailable. Refresh the list.');
          state.sessions??={};
          if(state.selectedMatch)state.sessions[state.selectedMatch.id]={setup:state.setup,label:state.label,rallies:state.rallies,cancelled:state.cancelled,selectedMatch:state.selectedMatch,history:state.history??[]};
          const remote=!saved&&selected.kind==='manual'?(await catalog({kind:'manual-session',matchId:selected.id})).session:null;
          const restored=remote?validateVideoState(remote.document):null;if(restored?.pending){restored.cancelled.push({...restored.pending,cancelledAt:new Date().toISOString()});restored.pending=null;}
          Object.assign(state,saved??restored??{setup:validateSetup({...defaults(),names:selected.names}),label:selected.tournamentName,rallies:[],cancelled:[],history:[]});state.selectedMatch=selected;state.connection=null;state.pending=null;return save(remote?{remote:{kind:'manual',payload:remote.document,revision:remote.revision,savedAt:remote.updated_at}}:{});
        }
        case 'select-match':{
          if(state.pending)throw Error('Finish or cancel the current rally before switching matches.');
          const tournament=state.catalog?.tournaments.find(t=>t.id===message.tournamentId);
          const selected=state.catalog?.matchesByTournament?.[message.tournamentId]?.find(m=>m.id===message.matchId);
          if(!tournament||!selected)throw Error('Choose a match from the selected tournament.');
          if(state.selectedMatch?.id===selected.id)return {state};
          const setup=validateSetup({...defaults(),names:selected.names});
          state.sessions??={};
          state.sessions[state.selectedMatch?.id??'unassigned']={setup:state.setup,label:state.label,rallies:state.rallies,cancelled:state.cancelled,selectedMatch:state.selectedMatch??null,history:state.history??[]};
          const saved=state.sessions[selected.id];
          Object.assign(state,saved??{setup,label:`${tournament.name} · ${selected.round??selected.category??'Match'}`,rallies:[],cancelled:[],history:[]});
          state.selectedMatch={...selected,tournamentName:tournament.name};state.connection=null;state.pending=null;return save();
        }
        case 'restore-cloud':{
          if(state.pending)throw Error('Finish or cancel the open rally before loading the server copy.');
          if(!state.selectedMatch||state.selectedMatch.id!==message.matchId)throw Error('Select this match first.');
          if(JSON.stringify(videoPayload(state))!==message.expectedHash)throw Error('Local scouting changed while loading. Your local copy is retained; try again.');
          const restored=validateVideoState(message.document);
          if(restored.pending){restored.cancelled.push({...restored.pending,cancelledAt:new Date().toISOString()});restored.pending=null;}
          Object.assign(state,restored);state.history=[];state.connection=null;return save();
        }
        case 'starting-score':{
          if(!state.selectedMatch)throw Error('Select a match first.');
          if(state.pending||state.rallies.some(r=>r.point))throw Error('Set the starting score before recording your first point.');
          state.setup.startingScore=validateStartingScore(message.score);state.setup.adjustments=[];return save();
        }
        case 'setup':{
          if(state.pending||state.rallies.some(r=>r.point))throw Error('Match setup is locked after scouting starts.');
          state.setup=validateSetup({...state.setup,...message.setup});return save();
        }
        case 'positions':{

          if(!['a','b'].includes(message.pair))throw Error('Choose a pair.');
          state.setup.positions??={a:false,b:false};state.setup.positions[message.pair]=!state.setup.positions[message.pair];return save();
        }
        case 'server':case 'ends':{
          if(state.pending&&message.type==='server')throw Error('Finish or cancel the rally before changing server.');
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
        case 'var-review':{
          if(!state.pending)throw Error('Start a rally before flagging a VAR review.');
          if(typeof message.reviewed!=='boolean')throw Error('Choose whether this point was reviewed.');
          if(message.reviewed)state.pending.varReviewed=true;else delete state.pending.varReviewed;
          return save();
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
        case 'touch':{
          if(!state.pending||!state.connection||state.pending.finish)throw Error('Start a rally before tapping shots.');
          if(!Number.isInteger(message.player)||message.player<0||message.player>3)throw Error('Choose a player.');
          if((state.pending.touches?.length??0)>=500)throw Error('This rally already has 500 shots.');
          const snapshot=await capture(state.connection);finishRally(state.pending,snapshot);
          (state.pending.touches??=[]).push({player:message.player,order:courtPlayers(state),snapshot});return save();
        }
        case 'smash':{
          if(!state.pending||!state.connection||state.pending.finish)throw Error('Start a rally before counting attempts.');
          if(!Number.isInteger(message.player)||message.player<0||message.player>3)throw Error('Choose a player.');
          const snapshot=await capture(state.connection);finishRally(state.pending,snapshot);
          const smashType=message.smashType!==undefined?validateSmashType(message.smashType):undefined;
          if(message.latestTouch){
            const touchIndex=(state.pending.touches?.length??0)-1,touch=state.pending.touches?.[touchIndex];
            if(!touch||touch.player!==message.player)throw Error('Tap this player’s shot first.');
            const existing=(state.pending.attempts??=[]).find(a=>a.touchIndex===touchIndex);
            if(existing){existing.smashType=smashType;return save();}
            state.pending.attempts.push({player:message.player,snapshot:touch.snapshot,touchIndex,...(smashType?{smashType}:{})});
          }else (state.pending.attempts??=[]).push({player:message.player,snapshot,...(smashType?{smashType}:{})});
          return save();
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
          let current=await capture(state.connection);startRally(current,state.label,'check');
          if(current.rate!==undefined&&current.rate!==1){
            if(!setRate)throw Error('Return the video to 1× before starting a rally.');
            const normal=await setRate(state.connection,current,1);
            if(normal.rate!==1||!sameMedia(current,normal)||normal.seekEpoch!==current.seekEpoch)throw Error('Could not restore normal playback. Reconnect before starting.');
            current=normal;
          }
          state.pending=startRally(current,state.label,uuid());
          return save();
        }
        case 'restart-rally':{
          if(!state.pending||!state.connection)throw Error('Start a rally and connect its video first.');
          if(state.pending.finish)throw Error('Save or clear the selected outcome before restarting.');
          let sample=await capture(state.connection);usable(sample);
          if(sample.ended||!sameMedia(state.pending.start,sample))throw Error('The video changed or ended. Cancel the rally and reconnect.');
          if(sample.rate!==undefined&&sample.rate!==1){
            if(!setRate)throw Error('Return the video to 1× before restarting a rally.');
            const normal=await setRate(state.connection,sample,1);
            if(normal.rate!==1||!sameMedia(sample,normal)||sample.seekEpoch!==normal.seekEpoch)throw Error('Could not restore normal playback. Reconnect before restarting.');sample=normal;
          }
          const next={id:uuid(),label:state.label,start:sample};
          state.cancelled.push({...state.pending,cancelledAt:new Date().toISOString()});
          state.pending=next;return save();
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
