import { auth } from '@/lib/auth'
import { issueScoutingProof } from '@/lib/scouting-extension-auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export async function GET(req: Request) {
  const user = (await auth())?.user
  if (!user?.isOperator) return json({ error: 'Sign in to Padel Nachos with an operator account. Your work is saved locally.' }, user ? 403 : 401)
  const id = new URL(req.url).searchParams.get('extensionId') ?? ''
  const origin = 'chrome-extension://' + id
  if (!/^[a-p]{32}$/.test(id) || (req.headers.get('origin') && req.headers.get('origin') !== origin)) return json({ error: 'Invalid extension.' }, 400)
  try { return json({ ...issueScoutingProof(user.id, origin), email: user.email ?? null }) }
  catch { return json({ error: 'Extension sign-in is unavailable. Your work is saved locally.' }, 503) }
}
