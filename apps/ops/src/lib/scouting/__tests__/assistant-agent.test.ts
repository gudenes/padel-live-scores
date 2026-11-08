import {beforeEach,it,expect,vi} from 'vitest'
const {query,db}=vi.hoisted(()=>({query:vi.fn(),db:vi.fn()}))
vi.mock('../assistant-query',()=>({assistantSchema:'Approved schema',queryAssistantData:query}))
vi.mock('../../db',()=>({pgPool:()=>({query:db})}))
import {answerWithDatabase} from '../assistant-agent'
import {emptyAssistantFilters} from '../assistant-filters'
const call=(name:string,args:unknown)=>({status:'completed',output:[{type:'function_call',name,call_id:'call-1',arguments:JSON.stringify(args)}]})
const final=(ids:string[]=[])=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Based on recorded matches.',reference_ids:ids})}]}]})
const fetchMock=(...responses:unknown[])=>{const f=vi.fn();for(const body of responses)f.mockResolvedValueOnce(new Response(JSON.stringify(body)));return f}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('OPENAI_API_KEY','test-key')})
it('grounds links in current tool evidence and preserves analytical answers without navigation',async()=>{
 const id='996172ca-811e-4203-908b-3afa83467b51';query.mockResolvedValue({rows:[{match_id:id,duration_minutes:134}],truncated:false});db.mockResolvedValue({rows:[{id,tournament:'Cancun'}]})
 const f=fetchMock(call('query_database',{sql:'SELECT match_id FROM assistant_matches'}),final([id,'invented-id'])),search=vi.fn()
 const result=await answerWithDatabase('Longest?',emptyAssistantFilters,[],search,f as typeof fetch)
 expect(result.kind).toBe('answer');expect(search).not.toHaveBeenCalled();expect(db.mock.calls[0][1]).toEqual([[id]])
 const request=JSON.parse(f.mock.calls[1][1].body);expect(request.store).toBe(false);expect(request.input.at(-1).output).toContain('134')
})
it('reports query failures to the model without exposing database details',async()=>{
 query.mockRejectedValue(Object.assign(Error('secret database details'),{code:'42501'}));const f=fetchMock(call('query_database',{sql:'SELECT 1'}),final())
 await answerWithDatabase('Count?',emptyAssistantFilters,[],vi.fn(),f as typeof fetch)
 expect(f.mock.calls[1][1].body).toContain('Query failed');expect(f.mock.calls[1][1].body).not.toContain('secret database details')
})
it('caps tool executions even when the model ignores tool_choice none',async()=>{
 query.mockResolvedValue({rows:[],truncated:false});const f=fetchMock(...Array.from({length:6},()=>call('query_database',{sql:'SELECT 1'})))
 await expect(answerWithDatabase('Count?',emptyAssistantFilters,[],vi.fn(),f as typeof fetch)).rejects.toThrow('query limit')
 expect(query).toHaveBeenCalledTimes(5);expect(JSON.parse(f.mock.calls[5][1].body).tool_choice).toBe('none')
})
it('does not verify or expose ungrounded references',async()=>{
 const f=fetchMock(final(['996172ca-811e-4203-908b-3afa83467b51']))
 const result=await answerWithDatabase('Help?',emptyAssistantFilters,[],vi.fn(),f as typeof fetch)
 expect('references' in result&&result.references).toEqual([]);expect(db).not.toHaveBeenCalled()
})
