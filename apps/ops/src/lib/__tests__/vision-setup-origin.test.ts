import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),check:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:mocks.auth}));
vi.mock('@/lib/rate-limit',()=>({check:mocks.check}));
import {POST} from '@/app/api/internal/lab-vision/setup/route';
beforeEach(()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('OPENAI_API_KEY','test');mocks.auth.mockResolvedValue({user:{id:'admin',isOperator:true}});mocks.check.mockReturnValue({allowed:true});});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});
function request(origin?:string,site='same-origin') {return new Request('http://localhost:8080/api/internal/lab-vision/setup',{method:'POST',headers:{...(origin?{origin}:{}),'Content-Type':'application/json','sec-fetch-site':site,'x-forwarded-host':'admin.padelnachos.com'},body:'{}'})}
it('allows the actual admin origin behind Railway to reach frame validation',async()=>{const r=await POST(request('https://admin.padelnachos.com'));expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'A JPEG frame is required.'})});
it.each([undefined,'null','https://evil.test','https://admin.padelnachos.com.evil.test','http://admin.padelnachos.com'])('rejects untrusted origin %s',async origin=>{expect((await POST(request(origin))).status).toBe(403);expect(mocks.check).not.toHaveBeenCalled()});
it('still rejects explicit cross-site requests',async()=>{expect((await POST(request('https://admin.padelnachos.com','cross-site'))).status).toBe(403)});
it('still requires an authenticated scouting account',async()=>{mocks.auth.mockResolvedValue(null);expect((await POST(request('https://admin.padelnachos.com'))).status).toBe(401)});
it('explains depleted API credits and keeps manual setup available',async()=>{
 const sharp=(await import('sharp')).default;
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#000'}}).jpeg().toBuffer();
 const fetchMock=vi.fn().mockResolvedValue(Response.json({error:{type:'insufficient_quota',code:'credit_balance_exhausted'}},{status:429}));
 vi.stubGlobal('fetch',fetchMock);
 try{
  const r=await POST(new Request('http://localhost:8080/api/internal/lab-vision/setup',{method:'POST',headers:{origin:'https://admin.padelnachos.com','Content-Type':'application/json'},body:JSON.stringify({image:'data:image/jpeg;base64,'+bytes.toString('base64')})}));
  expect(r.status).toBe(503);expect((await r.json()).error).toContain('no API credits remaining');expect(fetchMock).toHaveBeenCalledOnce();
 }finally{vi.unstubAllGlobals()}
});
