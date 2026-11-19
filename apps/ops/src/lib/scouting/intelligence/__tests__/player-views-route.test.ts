import {beforeEach, describe, expect, it, vi} from 'vitest'
const mocks = vi.hoisted(() => ({auth: vi.fn(), data: vi.fn()}))
vi.mock('@/lib/auth', () => ({auth: mocks.auth}))
vi.mock('@/lib/scouting-permissions', () => ({canViewReports: (user: unknown) => !!user}))
vi.mock('@/lib/scouting/intelligence/data', () => ({intelligenceData: mocks.data}))
vi.mock('@/lib/scouting/intelligence/model', () => ({aggregate: () => ({matches: 0}), pairKey: (ids: string[]) => ids.join('~')}))
vi.mock('@/lib/scouting/intelligence/country-ranking', () => ({countryRanking: () => null}))
vi.mock('@/lib/scouting/intelligence/benchmarks', () => ({benchmarks: () => ({})}))
import {GET} from '@/app/api/internal/scouting-intelligence/route'
const query = new URLSearchParams({rules: JSON.stringify({match: 'all', rules: [{field: 'birthplace', operator: 'contains', value: 'Barcelona'}]})})
describe('player views directory API', () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({user: {id: '1'}})
    mocks.data.mockResolvedValue({people: Array.from({length: 60}, (_, i) => ({id: String(i), name: `Player ${i}`, birthplace: i % 2 ? 'Barcelona' : 'Madrid', category: 'men'})), matches: [], history: [], excluded: 0})
  })
  it('filters the full directory before counts and pagination', async () => {
    const response = await GET(new Request('https://example.test/api?' + query + '&page=2'))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.count).toBe(30)
    expect(data.page).toBe(2)
    expect(data.rows).toHaveLength(6)
    expect(data.rows.every((row: {people: {birthplace: string}[]}) => row.people[0].birthplace === 'Barcelona')).toBe(true)
  })
  it('combines rules with category filters', async () => {
    const data = await (await GET(new Request('https://example.test/api?' + query + '&gender=women'))).json()
    expect(data.count).toBe(0)
  })
  it('sorts the entire result before pagination in both directions', async () => {
    const people=Array.from({length:30},(_,i)=>({id:String(i),name:'Player '+i,ranking:i===29?null:i+1,category:'women'}))
    mocks.data.mockResolvedValue({people,matches:[],history:[],excluded:0})
    const first=await (await GET(new Request('https://example.test/api?sort=rank:desc'))).json()
    expect(first.rows[0].people[0].ranking).toBe(29)
    expect(first.rows[23].people[0].ranking).toBe(6)
    const last=await (await GET(new Request('https://example.test/api?sort=rank:desc&page=2'))).json()
    expect(last.rows.map((r:{people:{ranking:number|null}[]})=>r.people[0].ranking)).toEqual([5,4,3,2,1,null])
    const asc=await (await GET(new Request('https://example.test/api?sort=rank:asc'))).json()
    expect(asc.rows[0].people[0].ranking).toBe(1)
  })
  it('sorts match totals within the selected season', async () => {
    const people=[{id:'a',name:'A'},{id:'b',name:'B'}]
    mocks.data.mockResolvedValue({people,matches:[],excluded:0,history:[
      {playerIds:['a'],date:'2025-01-01'},{playerIds:['a'],date:'2025-02-01'},
      {playerIds:['b'],date:'2026-01-01'}
    ]})
    const data=await (await GET(new Request('https://example.test/api?sort=matches:desc&year=2026'))).json()
    expect(data.rows.map((r:{id:string})=>r.id)).toEqual(['b','a'])
    expect(data.rows[0].totalMatches).toBe(1)
  })
  it('returns 400 for invalid rules', async () => {
    expect((await GET(new Request('https://example.test/api?rules=invalid'))).status).toBe(400)
  })
  it('keeps scouting authorization required', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await GET(new Request('https://example.test/api?' + query))).status).toBe(401)
  })
})
