import {it,expect,vi} from 'vitest'
const bridge=vi.hoisted(()=>({academy:true,academyTime:7,notifyAcademy:vi.fn()}))
vi.mock('../../../../../../public/scout-web/academy-bridge.mjs',()=>bridge)
it('uses real scout actions to score a memory-only academy rally',async()=>{
 // @ts-expect-error The browser scout is shipped as JavaScript without declarations.
 const {send}=await import('../../../../../../public/scout-web/practice-transport.mjs')
 expect((await send({type:'start'})).ok).toBe(true)
 bridge.academyTime=10.3
 expect((await send({type:'first-fault'})).ok).toBe(true)
 bridge.academyTime=18.503
 expect((await send({type:'touch',player:3})).ok).toBe(true)
 expect(bridge.notifyAcademy).toHaveBeenCalledWith(expect.objectContaining({action:'touch',player:3}))
 bridge.academyTime=32
 expect((await send({type:'prepare',player:2,outcome:'winner'})).ok).toBe(true)
 const saved=await send({type:'score',details:{shot:'volley'}})
 expect(saved.ok).toBe(true)
 expect(saved.state.rallies.at(-1).point).toMatchObject({player:2,outcome:'winner',shot:'volley'})
 expect(saved.state.setup.names[2]).toBe('Jairo Bautista')
 expect(saved.state.setup.positions.b).toBe(true)
 expect(saved.state.selectedMatch.players[1].country).toBe('BR')
 expect(bridge.notifyAcademy).toHaveBeenCalledWith(expect.objectContaining({action:'score',point:expect.objectContaining({shot:'volley'})}))
 expect((await send({type:'sync-server'})).ok).toBe(false)
})
