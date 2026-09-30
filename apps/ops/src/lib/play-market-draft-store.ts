import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { initialDrafts, validateDraft, type MarketDraft } from './play-market-drafts'
function directory() {
  const root = process.cwd().endsWith(path.join('apps', 'ops')) ? path.resolve(process.cwd(), '../..') : process.cwd()
  return path.join(root, '.local', 'play-market-drafts')
}
export async function readDrafts(): Promise<MarketDraft[]> {
  return Promise.all(initialDrafts().map(async draft => {
    try {
      const raw = JSON.parse(await readFile(path.join(directory(), `${draft.id}.json`), 'utf8'))
      return { ...validateDraft(raw), updatedAt: raw.updatedAt ?? null }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return draft
      throw error
    }
  }))
}
export async function saveDraft(raw: unknown): Promise<MarketDraft> {
  const draft = validateDraft(raw)
  await mkdir(directory(), { recursive: true, mode: 0o700 })
  const temp = path.join(directory(), `${randomUUID()}.tmp`)
  await writeFile(temp, JSON.stringify(draft, null, 2), { mode: 0o600 })
  await rename(temp, path.join(directory(), `${draft.id}.json`))
  return draft
}
