import { auth } from '@/lib/auth'
import { simulationCommand } from '@/lib/play-simulation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function guard(req: Request, write = false) {
  const url = new URL(req.url)
  if (process.env.NODE_ENV !== 'development' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return Response.json({ error: 'Simulation controls are available only in local development.' }, { status: 403 })
  }
  const session = await auth()
  if (!session?.user?.isOperator) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (write && req.headers.get('origin') !== url.origin) return Response.json({ error: 'Invalid origin' }, { status: 403 })
}

export async function GET(req: Request) {
  const denied = await guard(req)
  if (denied) return denied
  try {
    return Response.json(await simulationCommand(['admin-state']), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Could not read the local simulation. Check the local Node runtime and worker setup.' }, { status: 503 })
  }
}

export async function POST(req: Request) {
  const denied = await guard(req, true)
  if (denied) return denied
  const body = await req.json().catch(() => null)
  let args: string[]
  if (body?.action === 'pause' || body?.action === 'resume') args = [body.action]
  else if (body?.action === 'configure' && Number.isInteger(body.count) && body.count >= 1 && body.count <= 1000
    && Number.isInteger(body.intervalSeconds) && body.intervalSeconds >= 5 && body.intervalSeconds <= 300) {
    args = ['configure', String(body.count), String(body.intervalSeconds * 1000)]
  } else return Response.json({ error: 'Use 1–1,000 active bots and an interval of 5–300 seconds.' }, { status: 400 })
  try {
    await simulationCommand(args)
    return Response.json(await simulationCommand(['admin-state']))
  } catch {
    return Response.json({ error: 'The update could not be confirmed. Refresh the status before trying again.' }, { status: 503 })
  }
}
