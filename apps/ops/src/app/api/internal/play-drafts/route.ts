import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { readDrafts, saveDraft } from '@/lib/play-market-draft-store'
import { ROTTERDAM_ID, MAIN_DRAW_ROUNDS, type MatchCandidate } from '@/lib/play-market-drafts'
import { hasSameLocalOrigin } from '../../../../../../../src/lib/local-request-origin'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }) }
async function guard(req: Request, write = false) {
  if (process.env.NODE_ENV !== 'development' || !['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname)) return json({ error: 'Local development only.' }, 403)
  if (!(await auth())?.user?.isOperator) return json({ error: 'unauthorized' }, 401)
  if (write && !hasSameLocalOrigin(req)) return json({ error: 'Invalid origin.' }, 403)
}
export async function GET(req: Request) {
  const denied = await guard(req); if (denied) return denied
  try {
    const drafts = await readDrafts()
    const db = serviceClient()
    const result = await db.from('matches').select('id,category,round_canonical,status,scheduled_at,pred_pair1_prob,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id').eq('tournament_id', ROTTERDAM_ID).in('round_canonical', MAIN_DRAW_ROUNDS).limit(256)
    if (result.error) throw result.error
    const rows = (result.data ?? []) as unknown as Record<string, unknown>[]
    const keys = ['pair1_player1_id','pair1_player2_id','pair2_player1_id','pair2_player2_id']
    const ids = [...new Set(rows.flatMap(m => keys.map(k => m[k]).filter((v): v is string => typeof v === 'string')))]
    const players = ids.length ? await db.from('players').select('id,name').in('id',ids) : { data: [], error: null }
    if (players.error) throw players.error
    const names = new Map((players.data ?? []).map(p => [p.id, p.name]))
    const matches: MatchCandidate[] = rows.map(m => {
      const players = keys.map(k => typeof m[k] === 'string' ? names.get(m[k] as string) : null)
      const p = m.pred_pair1_prob == null ? null : Number(m.pred_pair1_prob)
      return { id: String(m.id), title: `${players[0] ?? 'TBD'} / ${players[1] ?? 'TBD'} vs ${players[2] ?? 'TBD'} / ${players[3] ?? 'TBD'}`,
        category: String(m.category), round: String(m.round_canonical), status: String(m.status),
        scheduledAt: typeof m.scheduled_at === 'string' ? m.scheduled_at : null,
        probability: p !== null && Number.isFinite(p) && p >= .02 && p <= .98 ? p : null,
        completePair: players.every(Boolean) }
    }).sort((a,b) => (a.scheduledAt ?? 'z').localeCompare(b.scheduledAt ?? 'z'))
    const event = await db.from('tournaments').select('name,cover_image_url,logo_url').eq('id',ROTTERDAM_ID).maybeSingle()
    return json({ drafts, matches, tournament: event.data ?? null })
  } catch { return json({ error: 'Could not load market drafts and the latest draw. Please retry.' }, 503) }
}
export async function POST(req: Request) {
  const denied = await guard(req, true); if (denied) return denied
  let raw: unknown
  try {
    const text = await req.text()
    if (text.length > 12000) return json({ error: 'Draft is too large.' }, 413)
    raw = JSON.parse(text)
  } catch { return json({ error: 'Invalid draft.' }, 400) }
  try { return json({ draft: await saveDraft(raw) }) }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Could not save draft.' }, 400) }
}
