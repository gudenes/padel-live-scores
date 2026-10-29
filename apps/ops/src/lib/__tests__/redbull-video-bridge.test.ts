import {it,expect,vi,afterEach} from 'vitest'
import {connectRedbull} from '../scouting/redbull-video-bridge'
const url='https://www.redbull.tv/es_ES/page/rrn:content:live-videos:f5a4e725-eabd-44f7-a22d-3be211e1c65f/kuwait'
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
function browser(){
 const listeners=new Set<(e:unknown)=>void>(),sent:Record<string,unknown>[]=[]
 const win={addEventListener:(_s:string,f:(e:unknown)=>void)=>listeners.add(f),removeEventListener:(_s:string,f:(e:unknown)=>void)=>listeners.delete(f),postMessage:(m:Record<string,unknown>)=>sent.push(m)}
 vi.stubGlobal('window',win);vi.stubGlobal('location',{origin:'https://admin.padelnachos.com'})
 const reply=(data:Record<string,unknown>,origin='https://admin.padelnachos.com',source:unknown=win)=>{const last=sent.at(-1)!;for(const f of listeners)f({source,origin,data:{...last,direction:'response',ok:true,...data}})}
 return {sent,reply,listeners}
}
it('uses fresh RPC timestamps for capture and rejects stale/disconnected samples',async()=>{
 vi.useFakeTimers();const b=browser(),p=connectRedbull(url);const sample={time:1793303900,mediaId:'m',videoId:'v'};b.reply({token:'t',sample});const bridge=await p
 expect(bridge.snapshot().time).toBe(1793303900)
 const capture=bridge.capture();b.reply({sample:{...sample,time:1793303904}});expect((await capture).time).toBe(1793303904)
 expect(b.sent.at(-1)).toMatchObject({action:'sample',token:'t'})
 vi.advanceTimersByTime(3001);expect(()=>bridge.snapshot()).toThrow('stale')
 const failure=bridge.capture();b.reply({ok:false,error:'The video changed'});await expect(failure).rejects.toThrow('video changed');expect(()=>bridge.snapshot()).toThrow('video changed')
 bridge.close();b.reply({});expect(()=>bridge.snapshot()).toThrow();await expect(bridge.capture()).rejects.toThrow('disconnected')
 expect(b.listeners.size).toBe(0)
})
it('ignores replies from another origin/window and cleans up a missing-extension timeout',async()=>{
 vi.useFakeTimers();const b=browser(),p=connectRedbull(url);const expected=expect(p).rejects.toThrow('Scout did not respond')
 b.reply({token:'x',sample:{}},'https://evil.test');b.reply({token:'x',sample:{}},'https://admin.padelnachos.com',{})
 expect(b.listeners.size).toBe(1);await vi.advanceTimersByTimeAsync(8000);await expected;expect(b.listeners.size).toBe(0)
})
it('propagates asynchronous seek failures instead of claiming replay succeeded',async()=>{
 const b=browser(),p=connectRedbull(url);b.reply({token:'t',sample:{time:100}});const bridge=await p
 const seek=bridge.seek(50);b.reply({ok:false,error:'This timestamp is no longer in the replay window.'});await expect(seek).rejects.toThrow('replay window');bridge.close();b.reply({})
})
