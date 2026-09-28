import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
describe('local avatar storage', () => {
  it('isolates owners, blocks traversal, serializes generation and persists the daily limit', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'padel-avatar-test-'))
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory)
    try {
      vi.resetModules()
      const store = await import('../avatar-local-store')
      const id = await store.saveLocalAvatar('alice', new Uint8Array([1,2,3]))
      expect(await store.readLocalAvatar('alice',id)).toEqual(Buffer.from([1,2,3]))
      await expect(store.readLocalAvatar('bob',id)).rejects.toMatchObject({status:404})
      await expect(store.readLocalAvatar('alice','../../secret')).rejects.toMatchObject({status:404})
      const release = await store.reserveAvatarGeneration('alice')
      await expect(store.reserveAvatarGeneration('alice')).rejects.toMatchObject({code:'generation_busy'})
      await release()
      for(let i=0;i<4;i++) await (await store.reserveAvatarGeneration('alice'))()
      vi.resetModules()
      const fresh = await import('../avatar-local-store')
      await expect(fresh.reserveAvatarGeneration('alice')).rejects.toMatchObject({code:'daily_limit'})
      await (await fresh.reserveAvatarGeneration('bob'))()
    } finally { cwd.mockRestore(); await rm(directory,{recursive:true,force:true}) }
  })
})
