import {savedReport,type SavedSession} from './saved-report'
import {methodologyAnalysis,DEFAULT_METHODOLOGY} from './methodology'

/** Use exactly the report's active-point replay and current methodology. */
export function librarySummary(session:SavedSession,source:'video'|'admin'){
 try{
  const report=savedReport(session,source)
  return {ratings:methodologyAnalysis(report.model.tracking.timeline,DEFAULT_METHODOLOGY).players.map(p=>p.score),points:report.model.points,sets:report.model.score.sets,partial:report.partial,failed:false}
 }catch{return {ratings:[null,null,null,null],points:null,sets:[],partial:false,failed:true}}
}
export function libraryDuration(value:unknown){
 if(typeof value!=='string'||!/^\d{1,2}:[0-5]\d$/.test(value))return null
 const [hours,minutes]=value.split(':').map(Number)
 return hours*60+minutes>0&&hours*60+minutes<=240?`${hours?`${hours}h `:''}${minutes}m`:null
}
