import type {Person} from './model'
import {birthFieldOptions} from './birthplace-fields'

export const viewFields = {
  birthplace: 'Birthplace text', birth_region: 'Birth region', birth_status: 'Birthplace status', country: 'Nationality code', category: 'Category',
  hand: 'Playing hand', side: 'Court side', ranking: 'World ranking',
} as const
export type ViewField = keyof typeof viewFields
export type ViewRule = {field: ViewField; operator: 'is' | 'contains' | 'any' | 'lte' | 'gte' | 'missing'; value: string}
export type PlayerRules = {match: 'all' | 'any'; rules: ViewRule[]}
export type PlayerView = PlayerRules & {id: string; name: string}
export const operators = {is: 'is', contains: 'contains', any: 'contains any of', lte: 'at most', gte: 'at least', missing: 'is not recorded'} as const
export function fieldOperators(field: ViewField): ViewRule['operator'][] {
  if (field === 'birth_region' || field === 'birth_status') return ['is', 'missing']
  return field === 'ranking' ? ['lte', 'gte', 'is', 'missing'] : ['is', 'contains', 'any', 'missing']
}
export function parsePlayerRules(raw: string): PlayerRules {
  if (raw.length > 8000) throw Error('Too many rules.')
  let value: PlayerRules
  try { value = JSON.parse(raw) } catch { throw Error('Invalid view rules.') }
  if (!value || !['all', 'any'].includes(value.match) || !Array.isArray(value.rules) || !value.rules.length || value.rules.length > 12) throw Error('Add between 1 and 12 rules.')
  for (const rule of value.rules) {
    if (!rule || !Object.hasOwn(viewFields, rule.field) || !fieldOperators(rule.field).includes(rule.operator) || typeof rule.value !== 'string' || rule.value.length > 500) throw Error('Invalid view rule.')
    if (rule.operator !== 'missing' && !rule.value.trim()) throw Error('Enter a value for every rule.')
    if (birthFieldOptions[rule.field] && rule.operator !== 'missing' && !Object.hasOwn(birthFieldOptions[rule.field], rule.value.trim())) throw Error('Select a valid birthplace value.')
    if (rule.field === 'ranking' && rule.operator !== 'missing' && (!/^\d+$/.test(rule.value.trim()) || Number(rule.value) < 1 || !Number.isSafeInteger(Number(rule.value)))) throw Error('Ranking must be a positive whole number.')
    if (rule.operator === 'any' && !rule.value.split(',').some(s => s.trim())) throw Error('Enter at least one comma-separated value.')
  }
  return {match: value.match, rules: value.rules.map(({field, operator, value}) => ({field, operator, value: value.trim()}))}
}
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
export function matchesPlayerRules(person: Person, view: PlayerRules): boolean {
  const results = view.rules.map(rule => {
    const actual = person[rule.field]
    const missing = actual == null || String(actual).trim() === '' || (rule.field === 'ranking' && Number(actual) <= 0)
    if (rule.operator === 'missing') return missing
    if (missing) return false
    if (rule.field === 'ranking') {
      const a = Number(actual), b = Number(rule.value)
      return rule.operator === 'lte' ? a <= b : rule.operator === 'gte' ? a >= b : a === b
    }
    const a = normalize(String(actual)), b = normalize(rule.value)
    if (rule.operator === 'any') return b.split(',').map(s => s.trim()).filter(Boolean).some(s => a.includes(s))
    return rule.operator === 'contains' ? a.includes(b) : a === b
  })
  return view.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}
