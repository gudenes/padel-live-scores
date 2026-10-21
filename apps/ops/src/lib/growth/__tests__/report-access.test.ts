import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/db',()=>({pgPool:()=>({query:mocks.query})}))
import {getReportAccess} from '../report-access'
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({user:{isOperator:true}})})
it('does not expose report emails to non-operators',async()=>{
 for(const user of [null,{isViewer:true},{isScouter:true}]){mocks.auth.mockResolvedValue({user});expect(await getReportAccess()).toBeNull()}
 expect(mocks.query).not.toHaveBeenCalled()
})
it('returns names and audit events without snapshots or share tokens',async()=>{
 mocks.query.mockResolvedValueOnce({rows:[{match_id:'m',manual:true,players:[{name:'A'},{name:'B'}],opens:2,viewers:1}]}).mockResolvedValueOnce({rows:[{email:'visitor@example.com',event:'report_viewed'}]})
 const data=await getReportAccess();expect(data?.reports[0].players).toEqual(['A','B']);expect(data?.activity[0].event).toBe('report_viewed');expect(mocks.query.mock.calls.every(c=>c[1][0]===30)).toBe(true)
})
it('distinguishes unavailable data from no activity',async()=>{
 mocks.query.mockRejectedValueOnce(new Error('offline'));expect(await getReportAccess()).toBeNull()
 mocks.query.mockResolvedValue({rows:[]});expect(await getReportAccess()).toEqual({reports:[],activity:[]})
})
