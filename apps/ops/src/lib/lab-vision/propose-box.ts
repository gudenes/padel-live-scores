/** Source-clock pose envelope. Never interpolate across cuts or fill missing detections. */
export function proposeBox(manifest:any,poses:any[],time:number,key:string){
 const segment=manifest.coverage?.find((c:number[])=>time>=c[0]&&time<=c[1])
 const [w,h]=manifest.sourceDimensions??[]
 if(!segment||!(w>0&&h>0))return null
 const frame=poses.filter(p=>p.t>=segment[0]&&p.t<=segment[1]&&Math.abs(p.t-time)<=.05&&p.players?.[key]).sort((a,b)=>Math.abs(a.t-time)-Math.abs(b.t-time))[0]
 if(!frame)return null
 const joints=frame.players[key]
 if(!Array.isArray(joints)||joints.length<17)return null
 const valid=(p:any)=>Array.isArray(p)&&p.length>=3&&p.every(Number.isFinite)&&p[2]>=.4&&p[0]>=0&&p[0]<=w&&p[1]>=0&&p[1]<=h
 // Require head, torso and feet: avoid a misleading tight box around a partial pose.
 if(!joints.slice(0,5).some(valid)||!joints.slice(5,7).every(valid)||!joints.slice(15,17).every(valid))return null
 const points=joints.filter(valid);if(points.length<10)return null
 const xs=points.map((p:number[])=>p[0]),ys=points.map((p:number[])=>p[1])
 const l=Math.min(...xs),r=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),height=bottom-top
 const x=Math.max(0,l-Math.max((r-l)*.15,height*.08)),y=Math.max(0,top-height*.1)
 const right=Math.min(w,r+Math.max((r-l)*.15,height*.08)),b=Math.min(h,bottom+height*.05)
 if((right-x)/w<.005||(b-y)/h<.005)return null
 return {box:{x:x/w,y:y/h,width:(right-x)/w,height:(b-y)/h},sampleTime:frame.t}
}

/** Annotation aid only: borrow a nearby box, never a measured position at contact. */
export function proposeReviewBox(manifest:any,poses:any[],time:number,key:string){
 const exact=proposeBox(manifest,poses,time,key)
 if(exact)return {...exact,borrowed:false}
 const segment=manifest.coverage?.find((c:number[])=>time>=c[0]&&time<=c[1])
 const nearby=poses.filter(p=>Math.abs(p.t-time)<=1&&p.players?.[key]&&(!segment||(p.t>=segment[0]&&p.t<=segment[1]))).sort((a,b)=>Math.abs(a.t-time)-Math.abs(b.t-time))
 for(const frame of nearby){
  const proposal=proposeBox(manifest,[frame],frame.t,key)
  if(proposal)return {...proposal,borrowed:true}
 }
 return null
}
