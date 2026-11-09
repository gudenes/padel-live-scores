import {validCourt,validPoints,type VideoSetup} from './scouting/video-setup'
export async function jobBody(req:Request,max=24000){
 const reader=req.body?.getReader();if(!reader)throw Error('JSON required.');let n=0,text='';const dec=new TextDecoder();
 for(;;){const r=await reader.read();if(r.done)break;n+=r.value.byteLength;if(n>max){await reader.cancel();throw Error('Request too large.')}text+=dec.decode(r.value,{stream:true})}
 return JSON.parse(text+dec.decode())
}
export function validateJobSetup(s:VideoSetup,video:{file_name:string;byte_size:number;duration_seconds:number}){
 if(!s||s.version!==1||s.confirmed!==true||!validPoints(s.points)||s.points.some(p=>!p)||!validCourt(s.points))throw Error('Confirm all court, net and player markers in video setup first.')
 if(!Array.isArray(s.playerNames)||s.playerNames.length!==4||new Set(s.playerNames).size!==4||s.playerNames.some(n=>typeof n!=='string'||!n.trim()||n.length>100)||!Array.isArray(s.identities)||s.identities.length!==4||new Set(s.identities).size!==4)throw Error('Confirm four different player identities.')
 // The wizard stores roster indices; older saved setups already contain names.
 const identities=s.identities.every(n=>typeof n==='string'&&/^[0-3]$/.test(n))?s.identities.map(n=>s.playerNames[Number(n)]):s.identities;
 if(identities.some(n=>!s.playerNames.includes(n))||new Set(identities).size!==4)throw Error('Confirm four different player identities.');
 if(s.file?.name!==video.file_name||s.file?.size!==Number(video.byte_size))throw Error('Setup belongs to a different video. Prepare the uploaded file first.')
 if(s.playerIds&&(!Array.isArray(s.playerIds)||s.playerIds.length!==4||new Set(s.playerIds).size!==4||s.playerIds.some(id=>typeof id!=='string'||id.length>100||!id.trim())))throw Error('Invalid player identities.')
 if(!['broadcast','fixed'].includes(s.recording))throw Error('Choose broadcast or static recording.')
 if(![s.duration,s.matchStart,s.calibrationTime,s.offset].every(Number.isFinite)||s.matchStart<0||s.matchStart>=video.duration_seconds||s.calibrationTime<0||s.calibrationTime>=video.duration_seconds||Math.abs(s.duration-video.duration_seconds)>2||s.offset<0)throw Error('Invalid video timing.')
 return {...s,identities}
}
export const jobJson=(b:unknown,status=200)=>Response.json(b,{status,headers:{'Cache-Control':'no-store'}})
