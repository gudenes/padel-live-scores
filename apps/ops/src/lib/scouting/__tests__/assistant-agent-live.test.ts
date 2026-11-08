import {it,expect} from 'vitest'
import {writeFile} from 'node:fs/promises'
import {answerWithDatabase} from '../assistant-agent'
import {emptyAssistantFilters} from '../assistant-filters'
import {resolveAssistantSearch} from '../assistant-search'
import {queryAssistantData} from '../assistant-query'
it.skipIf(process.env.RUN_MATCH_ASSISTANT_LIVE!=='1')('answers a real longest-match question with verified references and coverage',async()=>{
 const answer=await answerWithDatabase('What was Arturo Coello’s longest finished match in 2026? Tell me the duration, tournament, and how many of his matches have duration data.',emptyAssistantFilters,[],resolveAssistantSearch)
 await writeFile('/tmp/assistant-verified-answer.json',JSON.stringify(answer,null,2));expect(answer.kind).toBe('answer');expect('queried' in answer&&answer.queried).toBe(true);expect('references' in answer&&answer.references.length).toBeGreaterThan(0)
 const coverage=await queryAssistantData("SELECT count(*) AS total,count(duration_minutes) AS recorded,max(duration_minutes) AS longest FROM assistant_matches WHERE status='finished' AND match_date>='2026-01-01' AND match_date<='2026-11-06' AND '978d1b86-c53f-490f-88ce-bbe1be682228' IN (pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id)")
 console.log(JSON.stringify({verifiedCoverage:coverage.rows}));expect(answer.reply).toContain(String(coverage.rows[0].total));expect(answer.reply).toContain(String(coverage.rows[0].recorded));expect(answer.reply).toContain(String(coverage.rows[0].longest))
},100000)
