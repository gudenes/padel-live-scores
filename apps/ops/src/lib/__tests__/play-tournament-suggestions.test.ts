import { describe, it, expect } from 'vitest'
import { suggestTournamentConfigs, matchingTournamentMarket, type ProjectionPair } from '../play-tournament-suggestions'
const id = (n:number) => `${String(n).padStart(8,'0')}-1111-1111-1111-111111111111`
const event = {id:id(90),name:'Germany P2',starts_at:'2026-10-05',ends_at:'2026-10-11',level:'p2'}
const pair = (n:number, champion:number|null,finalist:number|null,semi:number|null,category:'men'|'women'='men'):ProjectionPair => ({category,pair_player_ids:[id(n),id(n+1)],champion_prob:champion,finalist_prob:finalist,semifinal_prob:semi,status:'active'})
const rows = [pair(1,.45,.65,.85),pair(3,.25,.5,.8),pair(5,.12,.4,.65),pair(7,.06,.2,.48)]
describe('tournament shortlist',()=>{
 it('suggests two champions and competitive final/semifinal picks in each draw',()=>{
  const picks=suggestTournamentConfigs(event,[...rows,...rows.map(p=>({...p,category:'women' as const,pair_player_ids:p.pair_player_ids.map((_,i)=>id(Number(p.pair_player_ids[0].slice(0,8))+50+i))}))])
  expect(picks).toHaveLength(8)
  expect(picks.map(p=>p.config.family)).toEqual(['champion','champion','round','round','champion','champion','round','round'])
  expect(picks[2].config.round).toBe('F');expect(picks[3].config.round).toBe('SF')
  expect(picks[0].config).toMatchObject({endsAt:'2026-10-11T23:59:59.000Z',voidAfter:'2026-10-18T23:59:59.000Z',probability:null,maxLoss:5000})
 })
 it('excludes eliminated pairs, unknown probabilities and malformed identities',()=>{
  expect(suggestTournamentConfigs(event,[{...rows[0],status:'eliminated'},pair(9,null,null,null),{...rows[0],pair_player_ids:['TBD',id(2)]}])).toEqual([])
 })
 it('deduplicates unordered pairs and is stable for database row order',()=>{
  const picks=suggestTournamentConfigs(event,[...rows,{...rows[0],pair_player_ids:[...rows[0].pair_player_ids].reverse()}])
  expect(picks).toHaveLength(4)
  expect(suggestTournamentConfigs(event,[...rows].reverse())).toEqual(suggestTournamentConfigs(event,rows))
 })
 it('does not fabricate suggestions without draw projections or an end date',()=>{
  expect(suggestTournamentConfigs(event,[])).toEqual([])
  expect(suggestTournamentConfigs({...event,ends_at:''},rows)).toEqual([])
 })
 it('recognises legacy and complementary champion markets as already covered',()=>{
  const config=suggestTournamentConfigs(event,rows)[0].config
  for (const resolver_key of ['tournament.pair_champion_v1','tournament.champion_is_pair','tournament.other_pair_wins_v1']) {
   expect(matchingTournamentMarket(config,[{id:'existing',category:'men',resolver_key,resolver_params:{player1Id:id(2),player2Id:id(1)}}])).toBe('existing')
  }
  expect(matchingTournamentMarket(config,[{id:'other',category:'women',resolver_key:'tournament.pair_champion_v1',resolver_params:{player1Id:id(1),player2Id:id(2)}}])).toBeNull()
 })
 it('does not confuse reaching the final with reaching the semifinal',()=>{
  const config=suggestTournamentConfigs(event,rows)[2].config
  const m={id:'round',category:'men',resolver_key:'tournament.pair_reaches_round_v1',resolver_params:{player1Id:config.playerIds[0],player2Id:config.playerIds[1],round:'SF'}}
  expect(matchingTournamentMarket(config,[m])).toBeNull()
  expect(matchingTournamentMarket(config,[{...m,resolver_params:{...m.resolver_params,round:'F'}}])).toBe('round')
 })
})
