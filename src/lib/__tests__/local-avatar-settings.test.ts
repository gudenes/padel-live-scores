import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { it, expect, vi } from 'vitest'
import { readAvatarSettings, writeAvatarSettings, avatarSettingsStatus } from '../local-avatar-settings'
it('encrypts credentials, shares settings with ops, masks status and rejects tampering', async () => {
 const root=await mkdtemp(path.join(tmpdir(),'avatar-settings-test-'))
 const cwd=vi.spyOn(process,'cwd').mockReturnValue(root)
 try {
  expect(await readAvatarSettings()).toEqual({enabled:false,apiKey:null})
  const settings={enabled:true,apiKey:'sk-private-test-key-1234'}
  await writeAvatarSettings(settings)
  const file=path.join(root,'.local/avatar-settings/settings.json')
  expect(await readFile(file,'utf8')).not.toContain(settings.apiKey)
  expect((await stat(file)).mode & 0o777).toBe(0o600)
  expect(avatarSettingsStatus(settings)).toEqual({enabled:true,configured:true,suffix:'1234'})
  cwd.mockReturnValue(path.join(root,'apps/ops'))
  expect(await readAvatarSettings()).toEqual(settings)
  await writeAvatarSettings({enabled:false,apiKey:null})
  expect(await readAvatarSettings()).toEqual({enabled:false,apiKey:null})
  await writeFile(file,'{"iv":"invalid"}')
  await expect(readAvatarSettings()).rejects.toThrow('Could not read')
 }finally{cwd.mockRestore();await rm(root,{recursive:true,force:true})}
})
