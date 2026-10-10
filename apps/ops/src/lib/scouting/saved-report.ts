import {validateDoc,replay,type ScoutDoc} from './model'
import type {ScoutPerson} from './export'
import {validateVideoState} from '../../../../../extensions/scouting-video-overlay/server-model.mjs'
import {scoutingDocument} from '../../../../../extensions/scouting-video-overlay/match.mjs'
import {publicReport} from '../../../../../extensions/scouting-video-overlay/public-report.mjs'

export interface SavedSession {document:unknown;players:ScoutPerson[];revision:number;updated_at:string}
export function savedReport(session:SavedSession,source:'video'|'admin'){
 if(session.players.length!==4)throw Error('Four saved players are required.')
 const video=source==='video'?validateVideoState(session.document):null
 // Video records are validated before conversion; admin event-count limits do not apply to them.
 const doc=video?scoutingDocument(video) as ScoutDoc:validateDoc(session.document)
 return {doc,model:replay(doc),players:session.players,source,revision:session.revision,updatedAt:session.updated_at,
  partial:!!(video?.setup.startingScore||doc.events.some(e=>e.kind==='score'||e.kind==='unclassified')),
  videoReport:video?publicReport({...session,document:video}):null,
  reviewedPointIds:video?(video.rallies as {id:string;point?:unknown;undone?:boolean;varReviewed?:boolean}[]).filter(r=>r.point&&!r.undone&&r.varReviewed).map(r=>r.id):[],
  original:session.document}
}
