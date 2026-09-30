/** Seed the approved shortlist as drafts only. Re-running preserves operator edits. */
import { createClient } from '@supabase/supabase-js'
import { SELECTED_BETA_MARKETS, VERIFIED_BETA_EVENTS, BETA_TITLE_SCOPES } from '../padelgod/src/lib/selected-beta-markets'
import { validateEditorialConfig, type EditorialConfig } from '../shared/play-editorial'
import { previewEditorial } from '../apps/ops/src/lib/play-editorial-service'
async function main() {
process.loadEnvFile('../.env.local')
const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_KEY!)
// IDs verified against Rotterdam projection pair membership and official player records.
const pairs={lebron:['3f700d1f-eb2b-41fb-a057-dd738bcd13fe','cf41febb-189d-4861-9099-aa1b34757bee'],
 coello:['978d1b86-c53f-490f-88ce-bbe1be682228','c95d2602-fb24-4b4b-9c60-40a0950a4eae'],
 josemaria:['2e725973-5f1c-45f2-9afb-439c2e32b40c','a4b05eb0-1337-4d81-80a2-f25fe2c7a5d6'],
 calvo:['1c365680-6e34-4c90-9ab4-234cfd1a459d','68060cb5-fc78-4b83-89fb-03bc9f68a766'],
 leal:['699d9934-8407-4b9a-ae4b-b0aecc7e44c0']}
const existing=await db.from('market_editorial_drafts').select('id,revision,config').limit(500)
if(existing.error)throw existing.error
for(const market of SELECTED_BETA_MARKETS){
 const id=market.sheetId
 const family=id<=25?'round':id===26?'other_champion':id===37?'ranking':'titles'
 const playerIds=id===23||id===30?pairs.lebron:id===24?pairs.josemaria:id===25?pairs.calvo:id===37?pairs.leal:pairs.coello
 const tournamentIds=id<=26?[VERIFIED_BETA_EVENTS.rotterdam]:id===29?[...BETA_TITLE_SCOPES['germany-milano-mexico']]:id===30?[...BETA_TITLE_SCOPES['premier-october-november']]:[]
 const config=validateEditorialConfig({family,category:market.category,playerIds,tournamentIds,
  round:id===23?'SF':'F',target:id===29?2:id===37?12:1,minimumStarts:id===29?3:id===30?2:1,
  startsAt:id<=26?'':'2026-10-01T00:00:00Z',endsAt:id<=26?'2026-10-04T23:59:59Z':'2026-11-30T23:59:59Z',
  locksAt:id<=26?'':'2026-10-01T00:00:00Z',voidAfter:id<=26?'2026-10-12T00:00:00Z':'2026-12-08T00:00:00Z',
  probability:null,probabilitySource:'',maxLoss:5000} satisfies EditorialConfig)
 const prior=existing.data?.find(d=>{const c=d.config as EditorialConfig;return c.family===family&&[...c.playerIds].sort().join()===config.playerIds.join()&&[...c.tournamentIds].sort().join()===config.tournamentIds.join()&&c.target===config.target&&c.round===config.round})
 if(prior){console.log(`${id}: existing draft ${prior.id}, preserved`);continue}
 const saved=await db.rpc('play_save_editorial_draft',{p_id:null,p_revision:0,p_config:config,p_actor:'codex:approved-column-L-shortlist'})
 if(saved.error)throw saved.error
 const preview=await previewEditorial(db as unknown as Parameters<typeof previewEditorial>[0],config)
 const reviewed=await db.rpc('play_preview_editorial_draft',{p_id:saved.data.id,p_revision:saved.data.revision,p_preview:preview,p_actor:'codex:approved-column-L-shortlist'})
 if(reviewed.error)throw reviewed.error
 console.log(JSON.stringify({sheetId:id,draftId:saved.data.id,question:preview.question.en,errors:preview.errors,probability:preview.probability,closesAt:preview.locksAt}))
}

}
void main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1})
