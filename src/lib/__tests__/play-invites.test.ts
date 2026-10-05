import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {invitationWindow,readInvitation,signInvitation} from '../play-invites'
const start=Date.parse('2026-10-05T00:00:00Z'),oldEnd=start+21*86400000
const id='12345678-1234-1234-1234-123456789012',origin='https://padelnachos.com'
beforeEach(()=>{vi.stubEnv('AUTH_SECRET','test-only-secret');vi.stubEnv('PLAY_INVITES_ENABLED','true');vi.stubEnv('PLAY_INVITES_START_AT','2026-10-05T00:00:00Z')})
afterEach(()=>vi.unstubAllEnvs())
describe('reusable invitation',()=>{
 it('stays open after launch until explicitly disabled',()=>{
  expect(invitationWindow(start-1)).toBeNull()
  expect(invitationWindow(start)).toEqual({start,end:null})
  expect(invitationWindow(start+365*86400000)).toEqual({start,end:null})
 })
 it('issues links without automatic expiry',()=>{
  const token=signInvitation(id,origin)
  expect(readInvitation(token,origin,start)).toEqual({issuer:id,end:null})
  expect(readInvitation(token,origin,oldEnd+365*86400000)).not.toBeNull()
 })
 it('preserves existing signed links beyond their original expiry',()=>{
  const token=signInvitation(id,origin,oldEnd)
  expect(readInvitation(token,origin,oldEnd+1)).toEqual({issuer:id,end:oldEnd})
 })
 it('rejects tampering and cross-environment use',()=>{
  const token=signInvitation(id,origin)
  expect(readInvitation('x'+token,origin,start)).toBeNull()
  expect(readInvitation(token,'http://localhost:3017',start)).toBeNull()
 })
 it('fails closed when disabled or unconfigured for new and legacy links',()=>{
  const tokens=[signInvitation(id,origin),signInvitation(id,origin,oldEnd)]
  vi.stubEnv('PLAY_INVITES_ENABLED','false')
  for(const token of tokens) expect(readInvitation(token,origin,start)).toBeNull()
  vi.stubEnv('PLAY_INVITES_ENABLED','true');vi.stubEnv('PLAY_INVITES_START_AT','')
  expect(invitationWindow(start)).toBeNull()
 })
})
