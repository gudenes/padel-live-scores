import catalogue from './geography/ine-2026.json'

export type Municipality = {id: string; name: string; province: string; region: string}
export type PreviewPlayer = {id: string; name: string; country: string | null; birthplace: string | null; ranking: number | null; profile_status: string | null}
export type PreviewStatus = 'catalunya' | 'other' | 'review' | 'missing'
export type PreviewResult = PreviewPlayer & {status: PreviewStatus; candidates: Municipality[]; reason: string}
export const previewLabels: Record<PreviewStatus, string> = {
  catalunya: 'Catalunya candidates', other: 'Other Spain candidates', review: 'Unresolved / review', missing: 'Missing birthplace',
}
export const catalogueSource = {url: catalogue.source, date: catalogue.referenceDate, count: catalogue.municipalities.length, catalunya: catalogue.municipalities.filter(m => m.region === '09').length}
export const catalunyaProvinces: Record<string, string> = {'08': 'Barcelona', '17': 'Girona', '25': 'Lleida', '43': 'Tarragona'}
export const normalizePlace = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim()
// Aliases resolve to official INE IDs, never to a free-text region guess.
const aliases: Record<string, string> = {'gerona': '17079', 'lerida': '25120', 'hospitalet de llobregat': '08101', 'la coruna': '15030', 'seville': '41091'}
const byId = new Map(catalogue.municipalities.map(m => [m.id, m]))
const byName = new Map<string, Municipality[]>()
function index(name: string, place: Municipality) {
  const key = normalizePlace(name), values = byName.get(key) ?? []
  if (!values.some(v => v.id === place.id)) byName.set(key, [...values, place])
}
for (const place of catalogue.municipalities) {
  index(place.name, place)
  // INE writes articles after a comma: "Garriga, La" → "La Garriga".
  for (const name of place.name.split('/')) {
    index(name, place)
    const match = name.match(/^(.+),\s*(L'|La|Les|El|Els|Los|Las|O|A|Os|As)$/i)
    if (match) index(match[2] + (match[2].endsWith("'") ? '' : ' ') + match[1], place)
  }
}
for (const [alias, id] of Object.entries(aliases)) {
  const place = byId.get(id)
  if (!place) throw Error('Unknown municipality alias: ' + id)
  index(alias, place)
}
// These names have well-known international collisions. Nationality is not
// evidence of birth country, so these proposals show an explicit warning.
const ambiguousInternational = new Set(['barcelona', 'cordoba', 'santiago', 'cuenca', 'guadalajara', 'cartagena', 'merida', 'leon', 'toledo', 'valencia', 'granada', 'madrid'])
export function previewBirthplace(player: PreviewPlayer): PreviewResult {
  const raw = normalizePlace(player.birthplace ?? '')
  if (!raw || ['-', '—', 'n/a', 'unknown', 'null', 'not recorded'].includes(raw)) return {...player, status: 'missing', candidates: [], reason: 'No usable birthplace recorded. Needs source enrichment.'}
  const parts = raw.split(',').map(s => s.trim())
  const explicitSpain = ['espana', 'spain', 'es'].includes(parts.at(-1) ?? '')
  // Only remove a known country suffix. Arbitrary substrings are never matched.
  const name = explicitSpain ? parts.slice(0, -1).join(',').trim() : raw
  const candidates = byName.get(name) ?? []
  if (!candidates.length) return {...player, status: 'review', candidates: [], reason: 'No exact municipality or supported alias in the Spain catalogue. May be abroad, a region, a typo or a missing alias.'}
  if (candidates.length > 1) return {...player, status: 'review', candidates, reason: 'Multiple Spanish municipalities share this name. Birth province or country evidence is needed.'}
  const place = candidates[0]
  const collision = !explicitSpain && ambiguousInternational.has(name)
  return {...player, status: place.region === '09' ? 'catalunya' : 'other', candidates,
    reason: `${Object.hasOwn(aliases, name) ? 'Known alias' : 'Exact normalized name'} → INE ${place.id}. ${explicitSpain ? 'Spain is explicit in the recorded text.' : collision ? 'International namesake exists: birth country must be verified.' : 'Birth country is not explicit; verify against the source.'} Proposed mapping only; nationality was not used.`}
}
export function summarizePreview(rows: PreviewResult[]) {
  return rows.reduce((counts, row) => {counts[row.status]++; return counts}, {catalunya: 0, other: 0, review: 0, missing: 0})
}
