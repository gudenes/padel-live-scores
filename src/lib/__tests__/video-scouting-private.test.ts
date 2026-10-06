import {afterEach,expect,it,vi} from 'vitest'
import {GET} from '../../app/api/video-scouting/[id]/route'
afterEach(()=>vi.unstubAllGlobals())
it('keeps saved scouting inaccessible through the public API without contacting storage',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 const response=GET()
 expect(response.status).toBe(404)
 expect(response.headers.get('cache-control')).toBe('no-store')
 expect(await response.json()).toEqual({error:'Not found'})
 expect(fetch).not.toHaveBeenCalled()
})
