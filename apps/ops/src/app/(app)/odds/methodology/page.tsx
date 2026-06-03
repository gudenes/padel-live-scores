import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MethodologyMarkdown } from '@/components/Odds/MethodologyMarkdown'
import { PageHeader, Panel } from '@/components/ui'

export const metadata = { title: 'Methodology · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function MethodologyPage() {
  // Path is relative to the ops app's cwd at runtime (apps/ops).
  // The spec lives at <repo>/docs/superpowers/specs/2026-05-27-elo-odds-model-design.md.
  const specPath = resolve(process.cwd(), '../../docs/superpowers/specs/2026-05-27-elo-odds-model-design.md')
  let source = ''
  try {
    source = await readFile(specPath, 'utf8')
  } catch {
    source = '# Methodology spec not found\n\nExpected file at `docs/superpowers/specs/2026-05-27-elo-odds-model-design.md`.'
  }

  return (
    <div className="ui-page">
      <PageHeader title="Methodology" />
      <Panel>
        <MethodologyMarkdown source={source} />
      </Panel>
    </div>
  )
}
