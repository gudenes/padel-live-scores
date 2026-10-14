const KEY='pn_consent'
let visitorId:string|undefined
export function analyticsChoice():boolean|null{
 try{const c=JSON.parse(localStorage.getItem(KEY)||'null');if(c&&typeof c.analytics==='boolean'&&Number.isFinite(Date.parse(c.decided_at))&&Date.now()-Date.parse(c.decided_at)<365*86400000)return c.analytics; if(localStorage.getItem('pn_analytics_opt_out')==='1')return false}catch{}
 return null
}
export function sharedReportEvent(event:string,properties:Record<string,string|boolean|number>={}){
 if(typeof window==='undefined'||analyticsChoice()!==true)return
 const key=process.env.NEXT_PUBLIC_POSTHOG_KEY
 if(!key)return
 try{
  visitorId??=sessionStorage.getItem('pn_report_analytics_id')||crypto.randomUUID()
  sessionStorage.setItem('pn_report_analytics_id',visitorId)
  // Explicit events only: never send the capability URL, email, code or video source.
  void fetch('https://eu.i.posthog.com/capture/',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',keepalive:true,body:JSON.stringify({api_key:key,event,properties:{distinct_id:visitorId,app_surface:'shared_report',environment:process.env.NODE_ENV,$process_person_profile:false,...properties}})}).catch(()=>{})
 }catch{}
}
export function chooseAnalytics(allowed:boolean){
 try{let previous;try{previous=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
 localStorage.setItem(KEY,JSON.stringify({analytics:allowed,push:previous?.push===true,decided_at:new Date().toISOString()}))}catch{}
}
