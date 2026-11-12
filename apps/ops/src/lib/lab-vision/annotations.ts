export const annotationKinds=['Shot contact','Player tracking issue','Ball tracking issue','Active-play boundary'] as const
export const shotTypes=['Unknown','Serve','Groundstroke','Volley','Lob','Smash','Bandeja','Vibora','Chiquita','Block','Bajada','Gancho','Rulo','Contrapared','Other'] as const
export function parseAnnotation(b:any,duration:number,players:string[]){
 if(!b||!annotationKinds.includes(b.kind)||!shotTypes.includes(b.shot)||!['Unknown','Forehand','Backhand'].includes(b.side)||!['Unknown','Cross-court','Down the line','Middle'].includes(b.direction)||!['needs_review','verified','excluded'].includes(b.status))throw Error('Choose valid annotation labels.')
 if(!Number.isFinite(b.time)||b.time<0||b.time>duration||!Number.isFinite(b.start)||!Number.isFinite(b.end)||b.start<0||b.start>b.time||b.end<b.time||b.end>duration)throw Error('Clip times must be inside the video and include the marked moment.')
 if(b.player!==''&&!players.includes(b.player))throw Error('Choose a player from this analysis.')
 if(typeof b.notes!=='string'||b.notes.length>2000)throw Error('Notes must be under 2,000 characters.')
 if(b.status==='verified'&&!b.confirmed)throw Error('Confirm that you reviewed this moment in the video.')
 const box=b.box??null
 if(box&&(!['x','y','width','height'].every(k=>Number.isFinite(box[k]))||box.x<0||box.y<0||box.width<.005||box.height<.005||box.x+box.width>1.000001||box.y+box.height>1.000001))throw Error('Bounding box must be inside the video frame.')
 const viewpoint=b.viewpoint??'Unknown',serveAttempt=b.serveAttempt??'Unknown'
 if(!['Unknown','Front','Back','Side / oblique'].includes(viewpoint)||!['Unknown','First','Second'].includes(serveAttempt))throw Error('Invalid serve details.')
 const boxOrigin=b.boxOrigin??'human'
 if(!['human','pose-proposal','pose-adjusted'].includes(boxOrigin))throw Error('Invalid box origin.')
 const candidateId=b.candidateId??null,serveDecision=b.serveDecision??null
 if(candidateId!==null&&(typeof candidateId!=='string'||!(/^(pose-wrist-peaks-v1:p[0-3]:\d+\.\d{3}|scout:[0-9a-f-]{36}:[0-9a-f-]{36}:(start|touch-\d+))$/i.test(candidateId))))throw Error('Invalid candidate.')
 if(serveDecision!==null&&!['serve','not_serve','uncertain'].includes(serveDecision))throw Error('Invalid serve decision.')
 if(serveDecision==='serve'&&(b.shot!=='Serve'||b.status!=='verified'||!b.player))throw Error('Confirm timing and player before approving a serve.')
 if(serveDecision==='not_serve'&&b.status!=='excluded')throw Error('Non-serve proposals must be excluded from serve training.')
 const shotRole=b.shotRole??'Unknown'
 if(!['Unknown','Serve','Return of serve','Rally shot'].includes(shotRole))throw Error('Invalid shot role.')
 const scoutSource=b.scoutSource??null
 if(scoutSource&&(!candidateId?.startsWith('scout:')||!Number.isFinite(scoutSource.time)||!Number.isFinite(scoutSource.offset)||!Number.isInteger(scoutSource.point)||scoutSource.point<1))throw Error('Invalid scouting provenance.')
 const quickDecision=b.quickDecision??null
 if(quickDecision!==null){
  if(!['shot','not_contact','uncertain'].includes(quickDecision)||!candidateId?.startsWith('scout:'))throw Error('Invalid quick review decision.')
  if(b.confirmed&&quickDecision!=='shot')throw Error('Only an approved contact can confirm timing.')
  if(b.status!==(quickDecision==='not_contact'?'excluded':quickDecision==='shot'&&b.confirmed?'verified':'needs_review'))throw Error('Invalid quick review status.')
 }
 const participants=b.participants??null
 if(participants!==null){
  if(!Array.isArray(participants)||participants.length!==4||new Set(participants.map((p:any)=>p.player)).size!==4)throw Error('Review all four players.')
  const roles=['Server','Server’s partner','Receiver','Receiver’s partner']
  for(const p of participants){
   if(!players.includes(p.player)||!['visible','not_visible','unmarked'].includes(p.visibility)||!roles.concat('Choose role').includes(p.role))throw Error('Invalid player role.')
   if(p.sourceFrameTime!=null&&(!Number.isFinite(p.sourceFrameTime)||p.sourceFrameTime<0||p.sourceFrameTime>duration||Math.abs(p.sourceFrameTime-b.time)>1.001))throw Error('Invalid nearby box source frame.')
   const v=p.box
   if(v&&(!['x','y','width','height'].every(k=>Number.isFinite(v[k]))||v.x<0||v.y<0||v.width<.005||v.height<.005||v.x+v.width>1.000001||v.y+v.height>1.000001))throw Error('Bounding box must be inside the video frame.')
   if((p.visibility==='visible'&&!v)||(p.visibility!=='visible'&&v))throw Error('Player visibility and box must agree.')
  }
  if(serveDecision==='serve'){
   if(new Set(participants.map((p:any)=>p.role)).size!==4||participants.some((p:any)=>!roles.includes(p.role)||p.visibility==='unmarked'))throw Error('Confirm four roles and boxes or mark not visible.')
   const person=(r:string)=>participants.find((p:any)=>p.role===r).player
   const team=(n:string)=>Math.floor(players.indexOf(n)/2)
   if(person('Server')!==b.player||team(person('Server'))!==team(person('Server’s partner'))||team(person('Receiver'))!==team(person('Receiver’s partner'))||team(person('Server'))===team(person('Receiver')))throw Error('Serve roles must match the two teams.')
  }
 }
 return {classificationReviewed:quickDecision==='shot'&&b.classificationReviewed===true&&b.shot!=='Unknown',playerIdentityVerified:quickDecision!==null?false:!!b.confirmed,quickDecision,timingVerified:!!b.confirmed,shotRole,scoutSource:scoutSource?{time:scoutSource.time,offset:scoutSource.offset,point:scoutSource.point}:null,participants:participants?.map((p:any)=>({player:p.player,role:p.role,visibility:p.visibility,...(p.sourceFrameTime!=null?{sourceFrameTime:p.sourceFrameTime}:{}),box:p.box?{x:p.box.x,y:p.box.y,width:p.box.width,height:p.box.height}:null}))??null,candidateId,serveDecision,boxOrigin,box:box?{x:box.x,y:box.y,width:box.width,height:box.height}:null,boxCoordinateSpace:'normalized-video-frame',boxSource:box?boxOrigin:null,viewpoint,serveAttempt,kind:b.kind,time:b.time,start:b.start,end:b.end,player:b.player,shot:b.shot,side:b.side,direction:b.direction,status:b.status,notes:b.notes,confirmed:!!b.confirmed}
}
