import {beforeEach,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),context:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));vi.mock('@/lib/scouting/report-context',()=>({reportContext:mocks.context}))
import {GET} from '../../app/api/internal/scouting/[id]/live-bootstrap/route'
import {scouterRouteAllowed} from '../scouting-permissions'
const id='072e0102-aff6-4a29-98b1-99740ae29032',params={params:Promise.resolve({id})},req=new Request('http://localhost')
beforeEach(()=>{vi.stubEnv('SCOUT_LIVE_EXPERIMENT','1');mocks.auth.mockResolvedValue({user:{id:'u',isScouter:true}});mocks.context.mockResolvedValue({players:[1,2,3,4].map(id=>({id:String(id),name:'Player'})),meta:{}})})
it('denies viewers even on direct API access',async()=>{mocks.auth.mockResolvedValue({user:{isViewer:true}});expect((await GET(req,params)).status).toBe(403);expect(scouterRouteAllowed(`/api/internal/scouting/${id}/live-bootstrap`,'GET',true)).toBe(false)})
it('permits staff and distinguishes production from local storage',async()=>{expect((await GET(req,params)).status).toBe(200);mocks.auth.mockResolvedValue({user:{id:'a',isOperator:true}});expect((await GET(req,params)).status).toBe(200);vi.stubEnv('SCOUT_LIVE_EXPERIMENT','0');expect(await (await GET(req,params)).json()).toMatchObject({localTest:false})})
