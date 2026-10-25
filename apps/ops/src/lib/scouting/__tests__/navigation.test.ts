import {describe,it,expect} from 'vitest'
import {scoutingPath,scoutingEntity,playerProfileHref,tournamentMatchesHref} from '../navigation'
const a='978d1b86-c53f-490f-88ce-bbe1be682228',b='43ac372d-0293-4791-9292-201e985e2ce6'
describe('scouting navigation',()=>{
 it('preserves exact filter and scroll anchor destinations',()=>{const path='/scouting?date=2026-10-25&scouting=scouted&page=2#results';expect(scoutingPath(path)).toBe(path)})
 it('rejects external and lookalike return destinations',()=>{for(const path of ['https://evil.test','//evil.test','/scouting-evil','/scouting/../../admin','/scouting\\evil','javascript:alert(1)'])expect(scoutingPath(path)).toBeNull()})
 it('keeps profile origin across sections without merging different players',()=>{expect(scoutingEntity('/scouting/players?player='+a+'&section=overview')).toBe(scoutingEntity('/scouting/players?player='+a+'&section=matches'));expect(scoutingEntity('/scouting/players?player='+a)).not.toBe(scoutingEntity('/scouting/players?player='+b))})
 it('creates order-independent pair identities and rejects placeholders',()=>{expect(playerProfileHref([a,b])).toBe(playerProfileHref([b,a]));expect(playerProfileHref([a,a])).toBeNull();expect(playerProfileHref(['unknown-0'])).toBeNull();expect(playerProfileHref([a,null])).toBeNull()})
})

it('separates tournament origins while retaining their filter changes',()=>{
 expect(scoutingEntity('/scouting?tournament='+a)).not.toBe(scoutingEntity('/scouting?date=2026-10-25'))
 expect(scoutingEntity('/scouting?tournament='+a+'&page=2')).toBe(scoutingEntity('/scouting?tournament='+a))
 expect(scoutingEntity('/scouting?tournament='+a)).not.toBe(scoutingEntity('/scouting?tournament='+b))
 expect(tournamentMatchesHref(a,'ignored')).toBe('/scouting?tournament='+a)
 expect(tournamentMatchesHref(null,'Private match')).toBeNull()
 expect(tournamentMatchesHref(null,'FCP & Catalunya')).toBe('/scouting?tournamentLabel=FCP+%26+Catalunya')
})
