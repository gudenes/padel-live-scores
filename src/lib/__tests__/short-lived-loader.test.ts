import {afterEach,expect,it,vi} from 'vitest'
import {shortLivedLoader} from '../short-lived-loader'
afterEach(()=>vi.useRealTimers())
it('coalesces concurrent reads, reuses successes and refreshes after expiry',async()=>{
 vi.useFakeTimers()
 const read=shortLivedLoader<number>(30_000)
 const load=vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
 expect(await Promise.all([read('week',load),read('week',load)])).toEqual([1,1])
 expect(await read('week',load)).toBe(1)
 expect(load).toHaveBeenCalledTimes(1)
 vi.advanceTimersByTime(30_001)
 expect(await read('week',load)).toBe(2)
 expect(load).toHaveBeenCalledTimes(2)
})
it('does not cache errors or mix different keys',async()=>{
 const read=shortLivedLoader<number>(30_000)
 const load=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(3)
 await expect(read('week',load)).rejects.toThrow('offline')
 expect(await read('week',load)).toBe(3)
 expect(await read('season',async()=>9)).toBe(9)
 expect(await read('week',load)).toBe(3)
})
