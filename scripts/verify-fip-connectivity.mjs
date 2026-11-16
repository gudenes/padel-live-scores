// Run with the production Node major (currently 24).
// Read-only FIP probes. Run in each deployed app; never invokes import/prune jobs.
// --instrumentation=PATH also verifies Next's emitted startup hook installs the proxy.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { getGlobalDispatcher } from 'undici'
import { installFipProxy } from '../shared/fip-http.mjs'

const instrumentation = process.argv.find(arg => arg.startsWith('--instrumentation='))?.split('=')[1]
if (instrumentation) {
  process.env.NEXT_RUNTIME = 'nodejs'
  process.env.SENTRY_DSN = '' // No telemetry from this one-off read-only process.
  const hook = await import(pathToFileURL(resolve(instrumentation)).href)
  const register = hook.register ?? hook.default?.register
  if (!register) throw new Error('Compiled instrumentation register hook missing')
  await register()
} else {
  installFipProxy()
}
if (!getGlobalDispatcher()[Symbol.for('padelnachos.fipProxy')]) throw new Error('FIP proxy was not installed')
console.log(JSON.stringify({ proxyInstalled: true, instrumentation: instrumentation ?? 'shared module' }))

async function read(label, url, array = true) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`)
  const data = await r.json()
  if (array && (!Array.isArray(data) || !data.length)) throw new Error(`${label}: empty/invalid JSON array`)
  console.log(JSON.stringify({ check: label, status: r.status, rows: Array.isArray(data) ? data.length : undefined }))
  return data
}
try {
  await read('news', 'https://www.padelfip.com/?rest_route=/wp/v2/posts&per_page=1&_embed=wp:featuredmedia')
  const events = await read('events and covers', 'https://www.padelfip.com/?rest_route=/wp/v2/events&per_page=2&orderby=modified&order=desc&_embed=true')
  await read('countries', 'https://www.padelfip.com/?rest_route=/wp/v2/country&per_page=2')
  const people = await read('player lookup', 'https://www.padelfip.com/?rest_route=/fip/v1/player/search&q=Arturo%20Coello')
  if (!people.some(p => p.player_id === 'P000010')) throw new Error('Player identity did not match Coello')
  const page = await fetch('https://www.padelfip.com/es/fip-rankings/', { signal: AbortSignal.timeout(30000) })
  if (!page.ok) throw new Error(`Rankings page: HTTP ${page.status}`)
  const html = await page.text()
  const match = html.match(/<\/svg>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/span>/)
  if (!match) throw new Error('Ranking publication date missing')
  const date = new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const year = date.getUTCFullYear()
  const week = Math.ceil((((date - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7)
  for (const gender of ['male', 'female']) {
    await read(`official ${gender}`, `https://www.padelfip.com/es/?rest_route=/fip/v1/ranking/load-more/&gender=${gender}&limit=2&offset=0&category=master&circuit=premierpadel&year=${year}&week=${week}&lang=es`)
    await read(`race ${gender}`, `https://www.padelfip.com/es/?rest_route=/fip/v1/player/search&search_type=race&gender=${gender}&limit=2&offset=0&category=master&circuit=premierpadel&lang=es`)
  }
  const mediaId = events.find(e => e.featured_media)?.featured_media
  if (!mediaId) throw new Error('No event media available to verify')
  const media = await read('media lookup', `https://www.padelfip.com/?rest_route=/wp/v2/media/${mediaId}`, false)
  if (!media.source_url) throw new Error('Media response missing URL')
  const image = await fetch(media.source_url, { signal: AbortSignal.timeout(30000) })
  if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) throw new Error('Artwork download failed')
  await image.arrayBuffer()
  console.log(JSON.stringify({ check: 'artwork', status: image.status }))
  console.log('PASS: all read-only FIP checks')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
