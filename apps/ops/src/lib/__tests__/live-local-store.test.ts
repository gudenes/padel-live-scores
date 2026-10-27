import {it,expect} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {localLiveStore,liveLocalEnabled} from '../scouting/live-local-store'
it('persists across store instances and serializes competing writes',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'scout-test-'));const id=crypto.randomUUID();try{const store=localLiveStore(dir);await store.update(id,async()=>({revision:1}));expect(await localLiveStore(dir).read(id)).toEqual({revision:1});const results=await Promise.allSettled([store.update(id,async row=>{await new Promise(r=>setTimeout(r,30));return {revision:row.revision+1}}),store.update(id,async row=>({revision:row.revision+1}))]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await store.read(id)).toEqual({revision:2});await expect(store.read('../oops')).rejects.toThrow('Invalid match')}finally{await rm(dir,{recursive:true,force:true})}})
it('never exposes local writes on the production hostname',()=>{expect(liveLocalEnabled(new Request('https://admin.padelnachos.com'))).toBe(false)})
