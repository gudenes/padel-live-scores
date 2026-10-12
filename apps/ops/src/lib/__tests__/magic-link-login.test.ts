import {afterEach,it,expect,vi} from 'vitest'
const mock=vi.hoisted(()=>({send:vi.fn(),signIn:vi.fn(),redirect:vi.fn()}))
vi.mock('resend',()=>({Resend:class{emails={send:mock.send}}}))
vi.mock('@/lib/auth',()=>({signIn:mock.signIn}))
vi.mock('next/navigation',()=>({redirect:mock.redirect}))
import {sendSignInEmail} from '../email/sign-in'
import {loginWithEmailLink} from '../../app/login/actions'
const form=()=>{const f=new FormData();f.set('email',' GBDenes@Gmail.com ');return f}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.resetAllMocks()})
it('requires delivery acceptance and includes plain-text sign-in instructions',async()=>{
 vi.stubEnv('RESEND_API_KEY','test-only');mock.send.mockResolvedValue({data:{id:'accepted'},error:null})
 await sendSignInEmail({to:'person@example.com',url:'https://admin.padelnachos.com/api/auth/callback/resend?token=test&email=test'})
 expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({to:'person@example.com',text:expect.stringContaining('expires in 24 hours'),html:expect.stringContaining('&amp;email=test')}))
})
it.each([{data:null,error:{name:'validation_error',message:'provider detail'}},{data:null,error:null}])('rejects failed/missing provider acceptance without logging credentials',async response=>{
 vi.stubEnv('RESEND_API_KEY','test-only');mock.send.mockResolvedValue(response);const log=vi.spyOn(console,'error').mockImplementation(()=>{})
 await expect(sendSignInEmail({to:'person@example.com',url:'https://admin.padelnachos.com/?token=private'})).rejects.toThrow('could not be sent')
 expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|person@example|provider detail/)
})
it('rejects missing service configuration before delivery',async()=>{
 vi.stubEnv('RESEND_API_KEY','');await expect(sendSignInEmail({to:'person@example.com',url:'https://admin.padelnachos.com'})).rejects.toThrow('unavailable');expect(mock.send).not.toHaveBeenCalled()
})
it('normalizes the email and redirects successful requests to Auth.js verification',async()=>{
 const target='https://admin.padelnachos.com/api/auth/verify-request?provider=resend&type=email';mock.signIn.mockResolvedValue(target)
 await loginWithEmailLink(undefined,form())
 expect(mock.signIn).toHaveBeenCalledWith('resend',{email:'gbdenes@gmail.com',redirectTo:'/',redirect:false})
 expect(mock.redirect).toHaveBeenCalledWith(target)
})
it.each(['https://admin.padelnachos.com/api/auth/error?error=Configuration','https://admin.padelnachos.com/login'])('shows a retry message rather than redirecting on unsuccessful auth URLs',async url=>{
 mock.signIn.mockResolvedValue(url);expect(await loginWithEmailLink(undefined,form())).toMatchObject({error:expect.stringContaining('continue with Google')});expect(mock.redirect).not.toHaveBeenCalled()
})
it('shows a friendly message on email/network exceptions',async()=>{
 mock.signIn.mockRejectedValue(Error('provider details'));expect(await loginWithEmailLink(undefined,form())).toMatchObject({error:expect.stringContaining('couldn’t send')});expect(mock.redirect).not.toHaveBeenCalled()
})
it('preserves the successful redirect signal instead of catching it as a failure',async()=>{
 mock.signIn.mockResolvedValue('https://admin.padelnachos.com/api/auth/verify-request');mock.redirect.mockImplementation(()=>{throw Error('NEXT_REDIRECT')})
 await expect(loginWithEmailLink(undefined,form())).rejects.toThrow('NEXT_REDIRECT')
})
