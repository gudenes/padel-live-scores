import { createServiceClient as serviceClient } from '../../../../../../../src/lib/supabase'
import { readProductionAvatarSettings, writeProductionAvatarSettings } from '../../../../../../../src/lib/production-avatar-settings'
import { hasSameLocalOrigin } from '../../../../../../../src/lib/local-request-origin'
import { auth } from '@/lib/auth'
import { readAvatarSettings, writeAvatarSettings, avatarSettingsStatus } from '../../../../../../../src/lib/local-avatar-settings'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }) }
async function guard(req: Request, write = false) {
  const url = new URL(req.url)
  if (process.env.NODE_ENV !== 'production' && (process.env.NODE_ENV !== 'development' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) return json({ error: 'Local development only.' },403)
  if (!(await auth())?.user?.isOperator) return json({ error: 'unauthorized' },401)
  if (write && !(process.env.NODE_ENV === 'production' ? req.headers.get('origin') === 'https://admin.padelnachos.com' : hasSameLocalOrigin(req))) return json({ error: 'Invalid origin.' },403)
}
const readSettings = () => process.env.NODE_ENV === 'production' ? readProductionAvatarSettings(serviceClient()) : readAvatarSettings()
const writeSettings = (s: {enabled:boolean;apiKey:string|null}) => process.env.NODE_ENV === 'production' ? writeProductionAvatarSettings(serviceClient(),s) : writeAvatarSettings(s)
export async function GET(req: Request) {
  const denied = await guard(req); if (denied) return denied
  try { return json(avatarSettingsStatus(await readSettings())) }
  catch { return json({ error: 'Could not read avatar settings.' },503) }
}
export async function POST(req: Request) {
  const denied = await guard(req,true); if (denied) return denied
  try {
    const raw = await req.text()
    if (raw.length > 2048) return json({error:'Request too large.'},400)
    const body = JSON.parse(raw)
    const settings = await readSettings()
    if (body.action === 'test') {
      if (!settings.apiKey) return json({error:'Save an OpenAI key first.'},400)
      const response = await fetch('https://api.openai.com/v1/models/gpt-image-2', { headers:{Authorization:`Bearer ${settings.apiKey}`},signal:AbortSignal.timeout(15000) })
      return response.ok ? json({ ...avatarSettingsStatus(settings), message:'OpenAI accepted the key and returned the image model. No image was generated.' }) : json({error: response.status === 401 ? 'OpenAI rejected this key.' : 'Could not verify image-model access. Check the key’s project permissions and try again.'},400)
    }
    if (body.action === 'save') {
      if (typeof body.enabled !== 'boolean') return json({error:'Choose enabled or disabled.'},400)
      if (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]{20,500}$/.test(body.apiKey))) return json({error:'Enter a valid OpenAI API key.'},400)
      settings.enabled = body.enabled
      if (body.apiKey) settings.apiKey = body.apiKey
      if (settings.enabled && !settings.apiKey) return json({error:'Add a key before enabling photo avatars.'},400)
    } else if (body.action === 'remove') { settings.apiKey = null; settings.enabled = false }
    else return json({error:'Unknown action.'},400)
    await writeSettings(settings)
    return json(avatarSettingsStatus(settings))
  } catch { return json({error:'Could not complete the request. Please retry.'},503) }
}
