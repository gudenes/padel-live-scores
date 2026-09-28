import { timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
const execute = promisify(execFile)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(req: Request) {
  const secret = process.env.PLAY_SIMULATION_ADMIN_SECRET
  const token = req.headers.get('authorization')?.replace(/^Bearer /,'') || ''
  if (!secret || !process.env.PLAY_SIMULATION_DB_PATH || Buffer.byteLength(token) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(token),Buffer.from(secret))) return Response.json({error:'not_found'},{status:404})
  const body = await req.json().catch(()=>null)
  const args = body?.args
  const valid = Array.isArray(args) && args.every(arg => typeof arg === 'string') && (
    (args.length===1 && ['admin-state','pause','resume'].includes(args[0])) ||
    (args.length===3 && args[0]==='configure' && /^[0-9]+$/.test(args[1]) && /^[0-9]+$/.test(args[2]) &&
      Number(args[1])>=1 && Number(args[1])<=1000 && Number(args[2])>=5000 && Number(args[2])<=300000)
  )
  if (!valid) return Response.json({error:'invalid_command'},{status:400})
  try {
    const {stdout}=await execute(process.execPath,[path.join(process.cwd(),'scripts/play-simulation/cli.mjs'),...args],{timeout:10000,maxBuffer:1024*1024})
    return Response.json({...JSON.parse(stdout),mode:'production_simulation'},{headers:{'Cache-Control':'no-store'}})
  } catch { return Response.json({error:'simulation_unavailable'},{status:503}) }
}
