import {it,expect,vi,afterEach} from 'vitest'
import {scoutingEventId} from '../scouting/event-id'
afterEach(()=>vi.unstubAllGlobals())
it('generates unique valid UUIDs when a local phone has no secure-context randomUUID',()=>{
 const original=globalThis.crypto
 vi.stubGlobal('crypto',{getRandomValues:original.getRandomValues.bind(original)})
 const ids=Array.from({length:100},()=>scoutingEventId())
 expect(new Set(ids).size).toBe(100)
 ids.forEach(id=>expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/))
})
