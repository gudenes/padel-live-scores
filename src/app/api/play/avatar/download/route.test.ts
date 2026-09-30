import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const access=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/play-access',()=>({requirePlayAccess:access}))
import {POST} from './route'
const png='data:image/png;base64,iVBORw0KGgo='
function request(image=png,origin='https://padelnachos.com') {return new Request('https://padelnachos.com/api/play/avatar/download',{method:'POST',headers:{origin},body:new URLSearchParams({image,format:'full'})})}
beforeEach(()=>{vi.stubEnv('NODE_ENV','production');access.mockResolvedValue({userId:'invited'})})
afterEach(()=>vi.unstubAllEnvs())
it('returns a private PNG attachment without storing an image',async()=>{const r=await POST(request());expect(r.status).toBe(200);expect(r.headers.get('Content-Disposition')).toBe('attachment; filename="padel-nachos-full.png"');expect(r.headers.get('Cache-Control')).toContain('no-store');expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([137,80,78,71,13,10,26,10]))})
it('blocks anonymous and uninvited users',async()=>{access.mockResolvedValue(null);expect((await POST(request())).status).toBe(404)})
it('blocks foreign forms and non-PNG content',async()=>{expect((await POST(request(png,'https://evil.example'))).status).toBe(403);expect((await POST(request('data:image/png;base64,PGh0bWw+'))).status).toBe(400)})
it('bounds request size before decoding',async()=>{expect((await POST(request('x'.repeat(6*1024*1024)))).status).toBe(413)})
it('can open the PNG visibly for browsers without downloads',async()=>{const req=new Request('https://padelnachos.com/api/play/avatar/download?display=inline',{method:'POST',headers:{origin:'https://padelnachos.com'},body:new URLSearchParams({image:png,format:'full'})});const r=await POST(req);expect(r.status).toBe(200);expect(r.headers.get('Content-Disposition')).toBe('inline; filename="padel-nachos-full.png"');expect(r.headers.get('Content-Type')).toBe('image/png')})
