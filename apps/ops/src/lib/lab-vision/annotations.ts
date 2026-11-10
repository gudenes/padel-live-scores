export const annotationKinds=['Shot contact','Player tracking issue','Ball tracking issue','Active-play boundary'] as const
export const shotTypes=['Unknown','Serve','Groundstroke','Volley','Lob','Smash','Bandeja','Vibora','Chiquita','Block','Bajada'] as const
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
 if(candidateId!==null&&(typeof candidateId!=='string'||!/^pose-wrist-peaks-v1:p[0-3]:\d+\.\d{3}$/.test(candidateId)))throw Error('Invalid candidate.')
 if(serveDecision!==null&&!['serve','not_serve','uncertain'].includes(serveDecision))throw Error('Invalid serve decision.')
 if(serveDecision==='serve'&&(b.shot!=='Serve'||b.status!=='verified'||!b.player))throw Error('Confirm timing and player before approving a serve.')
 if(serveDecision==='not_serve'&&b.status!=='excluded')throw Error('Non-serve proposals must be excluded from serve training.')
 return {candidateId,serveDecision,boxOrigin,box:box?{x:box.x,y:box.y,width:box.width,height:box.height}:null,boxCoordinateSpace:'normalized-video-frame',boxSource:box?boxOrigin:null,viewpoint,serveAttempt,kind:b.kind,time:b.time,start:b.start,end:b.end,player:b.player,shot:b.shot,side:b.side,direction:b.direction,status:b.status,notes:b.notes,confirmed:!!b.confirmed}
}
