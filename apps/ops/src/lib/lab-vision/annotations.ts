export const annotationKinds=['Shot contact','Player tracking issue','Ball tracking issue','Active-play boundary'] as const
export const shotTypes=['Unknown','Serve','Groundstroke','Volley','Lob','Smash','Bandeja','Vibora','Chiquita','Block','Bajada'] as const
export function parseAnnotation(b:any,duration:number,players:string[]){
 if(!b||!annotationKinds.includes(b.kind)||!shotTypes.includes(b.shot)||!['Unknown','Forehand','Backhand'].includes(b.side)||!['Unknown','Cross-court','Down the line','Middle'].includes(b.direction)||!['needs_review','verified','excluded'].includes(b.status))throw Error('Choose valid annotation labels.')
 if(!Number.isFinite(b.time)||b.time<0||b.time>duration||!Number.isFinite(b.start)||!Number.isFinite(b.end)||b.start<0||b.start>b.time||b.end<b.time||b.end>duration)throw Error('Clip times must be inside the video and include the marked moment.')
 if(b.player!==''&&!players.includes(b.player))throw Error('Choose a player from this analysis.')
 if(typeof b.notes!=='string'||b.notes.length>2000)throw Error('Notes must be under 2,000 characters.')
 if(b.status==='verified'&&!b.confirmed)throw Error('Confirm that you reviewed this moment in the video.')
 return {kind:b.kind,time:b.time,start:b.start,end:b.end,player:b.player,shot:b.shot,side:b.side,direction:b.direction,status:b.status,notes:b.notes,confirmed:!!b.confirmed}
}
