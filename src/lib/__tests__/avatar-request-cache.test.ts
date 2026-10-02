import {expect,it,vi} from 'vitest'
import {createAvatarRequestCache} from '../avatar-request-cache'
it('reuses concurrent and remounted requests without mixing accounts',async()=>{
 const cache=createAvatarRequestCache<string>(),load=vi.fn().mockResolvedValue('correct')
 await Promise.all([cache.read('a:b',load),cache.read('a:b',load)])
 await cache.read('a:b',load);expect(load).toHaveBeenCalledTimes(1)
 await cache.read('other:b',load);expect(load).toHaveBeenCalledTimes(2)
})
it('keeps the correct appearance after a failed refresh and supports saved updates',async()=>{
 const cache=createAvatarRequestCache<string>();cache.prime('a','old')
 await expect(cache.read('a',()=>Promise.reject(Error()),true)).rejects.toThrow()
 expect(cache.peek('a')).toBe('old')
 cache.prime('a','new');expect(await cache.read('a',()=>Promise.resolve('wrong'))).toBe('new')
})
