import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireRaceLock } from './lock'
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
it('excludes another refresh and records ownership', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'race-lock-')); directories.push(dir)
  const lock = path.join(dir, 'men.lock')
  expect(await acquireRaceLock(lock)).toBe(true)
  expect(await acquireRaceLock(lock)).toBe(false)
  expect(await readFile(path.join(lock, 'pid'), 'utf8')).toBe(String(process.pid))
})
it('recovers a dead owner but protects a lock still being initialized', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'race-lock-')); directories.push(dir)
  const lock = path.join(dir, 'watcher.lock'); await mkdir(lock)
  expect(await acquireRaceLock(lock)).toBe(false)
  await writeFile(path.join(lock, 'pid'), '2147483647')
  expect(await acquireRaceLock(lock)).toBe(true)
})
