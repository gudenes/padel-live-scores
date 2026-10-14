import {afterEach,expect,it,vi} from 'vitest'
const send=vi.hoisted(()=>vi.fn().mockResolvedValue({data:{id:'test'},error:null}))
vi.mock('resend',()=>({Resend:class{emails={send}}}))
import {sendReportCode} from '../report-code'
afterEach(()=>{vi.unstubAllEnvs();send.mockClear()})
it.each(['','   '])('uses a valid sender when the configured sender is blank (%s)',async value=>{
 vi.stubEnv('RESEND_API_KEY','test');vi.stubEnv('AUTH_EMAIL_FROM',value)
 await sendReportCode('delivered@resend.dev','123456')
 expect(send.mock.calls[0][0].from).toBe('Padel Labs <admin@padelnachos.com>')
})
it('preserves a configured sender',async()=>{
 vi.stubEnv('RESEND_API_KEY','test');vi.stubEnv('AUTH_EMAIL_FROM','  Reports <reports@example.com>  ')
 await sendReportCode('delivered@resend.dev','123456')
 expect(send.mock.calls[0][0].from).toBe('Reports <reports@example.com>')
})
