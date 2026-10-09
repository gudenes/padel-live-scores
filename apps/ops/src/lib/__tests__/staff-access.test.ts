import {beforeEach,expect,it,vi} from 'vitest'
const query=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/db',()=>({pgPool:()=>({query})}))
import {isUserScouter,bindScoutingGrant} from '../staff-access'
beforeEach(()=>{query.mockReset();query.mockResolvedValue({rowCount:1})})
it('rechecks active membership on each request instead of caching grants in JWTs',async()=>{
 expect(await isUserScouter('a')).toBe(true)
 query.mockResolvedValueOnce({rowCount:0})
 expect(await isUserScouter('a')).toBe(false)
 expect(query).toHaveBeenCalledTimes(2)
 expect(query.mock.calls[0][0]).toContain("status='active'")
})
it('binds only the authenticated UUID and requires verification for pending emails',async()=>{
 await bindScoutingGrant('a')
 expect(query.mock.calls[0][1]).toEqual(['a',false])
 expect(query.mock.calls[0][0]).toContain('u."emailVerified" is not null or $2::boolean')
 expect(query.mock.calls[0][0]).toContain('g.user_id is null')
 await bindScoutingGrant('a',true)
 expect(query.mock.calls[1][1]).toEqual(['a',true])
})
it('fails closed when the migration is missing, but propagates unexpected failures',async()=>{
 query.mockRejectedValue({code:'42P01'})
 expect(await isUserScouter('a')).toBe(false)
 await expect(bindScoutingGrant('a')).resolves.toBeUndefined()
 query.mockRejectedValue(Error('connection lost'))
 await expect(isUserScouter('a')).rejects.toThrow('connection lost')
})
