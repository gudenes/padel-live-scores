import {afterEach,it,expect,vi} from 'vitest'
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules()})
it.each(['pro','expert'])('initializes %s using the real scouting preference',async mode=>{
 vi.stubGlobal('location',{href:`http://localhost/scout-web/panel.html?playground&academy=1&mode=${mode}`})
 // @ts-expect-error Browser module has no TypeScript declarations.
 const {preferences}=await import('../../../../../../public/scout-web/practice-mode.mjs')
 expect(preferences.getItem('pn-rally-taps')).toBe(mode==='expert'?'on':'off')
})
