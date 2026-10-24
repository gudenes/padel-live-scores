import {it,expect} from 'vitest'
import {pgPool} from '@/lib/db'
import {savedReport} from '../../saved-report'
import {methodologyAnalysis} from '../../methodology'
import {convertSession,type SessionRow} from '../model'
// Opt-in read-only integration check against the configured database.
it.skipIf(process.env.INTELLIGENCE_INTEGRATION!=='1')('matches existing report calculations for stored video sessions',async()=>{
 const db=pgPool()
 try{
  const {rows}=await db.query("select match_id,document,players,revision,updated_at,'video' as source,false as manual,null as date,'Test' as tournament,null as round from operator_video_scouting_sessions order by updated_at desc limit 3")
  let compared=0
  for(const row of rows as SessionRow[]){
   const baseline=savedReport(row,'video'),actual=convertSession(row,new Map())
   if(!baseline.model.points){expect(actual).toBeNull();continue}
   expect(actual!.stats).toEqual(baseline.model.stats)
   expect(actual!.points.map(p=>p.id)).toEqual(baseline.model.tracking.timeline.map(p=>p.id))
   expect(actual!.impact).toEqual(methodologyAnalysis(baseline.model.tracking.timeline).players.map(p=>p.impact))
   compared++
  }
  console.info('Stored report parity verified:',compared)
 }finally{await db.end()}
},120000)
