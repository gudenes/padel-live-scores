import {currentSeason} from './season'
import {validDirectorySort} from './directory-sort'
import {parsePlayerRules, type PlayerView, type PlayerRules} from './player-views'
export const defaultSearch = {q:'', gender:'', year:currentSeason(), sort:'scouted', filter:'all'}
export type SavedSearch = typeof defaultSearch
export type SavedPlayerView = PlayerView & {search: SavedSearch}
export const serializeRules = (v: PlayerRules) => v.rules.length ? JSON.stringify({match:v.match,rules:v.rules}) : ''
export function readSavedView(value: unknown): SavedPlayerView {
  if (!value || typeof value !== 'object') throw Error('Invalid saved view')
  const v = value as Record<string,unknown>
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || !v.name.trim()) throw Error('Invalid saved view')
  const rules: PlayerRules = Array.isArray(v.rules) && !v.rules.length ? {match:'all',rules:[]} : parsePlayerRules(JSON.stringify(v))
  const input = v.search && typeof v.search === 'object' ? v.search as Record<string,unknown> : {}
  const search = {...defaultSearch}
  for (const key of Object.keys(search) as (keyof SavedSearch)[]) if (typeof input[key] === 'string') search[key] = input[key]
  if (!['','men','women'].includes(search.gender) || !validDirectorySort(search.sort) || !['all','scouted','watch'].includes(search.filter)) throw Error('Invalid saved filters')
  return {...rules,id:v.id,name:v.name,search}
}
export function savedViewChanges(view: SavedPlayerView): Record<string,string|null> {
  return {...view.search,rules:serializeRules(view)||null,savedView:view.id,page:null}
}
export function sameSearch(a: SavedSearch,b: SavedSearch) {
  return (Object.keys(defaultSearch) as (keyof SavedSearch)[]).every(key=>a[key]===b[key])
}
