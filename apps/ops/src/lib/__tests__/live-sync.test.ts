import {it,expect,vi} from 'vitest'
// @ts-expect-error Browser JavaScript module is exercised directly in this runtime test.
import {liveSync} from '../../../public/scout-web/live-sync.mjs'
const state=(n=0)=>({rallies:Array(n).fill({point:{player:1}}),pending:null})
function setup(request:any){const envelope={state:state(),revision:0,dirty:false,generation:0,outbox:null,completed:false};const stored:any[]=[];const sync=liveSync({envelope,store:async(value:any)=>{stored.push(structuredClone(value))},payload:(s:any)=>s,request,delay:60000});return {sync,envelope,stored}}
it('does not wait for slow network during capture and finishes with the newest state',async()=>{
 let resolve:any;const request=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockImplementation(async b=>({revision:b.revision+1,savedAt:'now'}));const {sync,envelope}=setup(request)
 await sync.update(state(1));const pending=sync.flush();await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
 await sync.update(state(2));expect(envelope.state.rallies).toHaveLength(2);expect(request).toHaveBeenCalledTimes(1)
 resolve({revision:1,savedAt:'now'});await pending;expect(envelope.dirty).toBe(true)
 await sync.finish();expect(request.mock.calls.at(-1)?.[0]).toMatchObject({completed:true,revision:1,document:state(2)});expect(envelope.dirty).toBe(false);sync.close()
})
it('retries the identical outbox after a lost response',async()=>{const request=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue({revision:1});const {sync,envelope,stored}=setup(request);await sync.update(state(1));await expect(sync.flush()).rejects.toThrow('offline');expect(envelope.outbox).toBeTruthy();expect(stored.some(s=>s.outbox)).toBe(true);await sync.flush();expect(request.mock.calls[0][0]).toEqual(request.mock.calls[1][0]);sync.close()})
it('blocks finish for pending rallies and conflicts, retaining local data',async()=>{const request=vi.fn().mockRejectedValue(Object.assign(Error('conflict'),{status:409}));const {sync,envelope}=setup(request);await sync.update({...state(),pending:{id:'open'}});await expect(sync.finish()).rejects.toThrow('current rally');await sync.update(state(1));await expect(sync.flush()).rejects.toThrow('conflict');await expect(sync.finish()).rejects.toThrow('conflict');expect(envelope.state.rallies).toHaveLength(1);sync.close()})
it('keeps edits made while upload preparation is running for the next upload',async()=>{let prepare:any;const envelope={state:state(1),revision:0,dirty:true,generation:1,outbox:null,completed:false};const request=vi.fn().mockResolvedValue({revision:1});const sync=liveSync({envelope,store:async()=>{},payload:()=>new Promise(resolve=>{prepare=resolve}),request,delay:60000});const uploading=sync.flush();await sync.update(state(2));prepare(state(1));await uploading;expect(envelope.dirty).toBe(true);expect(envelope.state.rallies).toHaveLength(2);sync.close()})
