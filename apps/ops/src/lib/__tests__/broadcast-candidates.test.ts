import {describe,it,expect} from 'vitest'
import {courtKey,rankBroadcasts,parseReplayTime} from '../scouting/broadcast-candidates'
const match={id:'m',tournament:'Kuwait',court:'CENTER COURT BNK',startedAt:'2026-10-27T10:30:00Z',scheduledAt:'2026-10-27T09:00:00Z',timezone:'Asia/Kuwait'}
const row={videoId:'v',title:'Kuwait · Pista Central',court:null,start:'2026-10-27T08:00:00Z',end:'2026-10-27T20:00:00Z',state:'archived'}
describe('broadcast matching',()=>{
 it('normalizes sponsored and multilingual court labels without conflating numbers',()=>{expect(courtKey('Court 2 NIC')).toBe('court-2');expect(courtKey('Pista Central')).toBe(courtKey(match.court));expect(courtKey('Court 12')).not.toBe(courtKey('Court 2'))})
 it('suggests a match-specific position only for matching courts',()=>{expect(rankBroadcasts(match,[row])[0].suggestedOffset).toBe(9000);expect(rankBroadcasts(match,[{...row,title:'Court 2'}])[0].suggestedOffset).toBeNull()})
 it('does not use scheduled time or clamp negative times into false start positions',()=>{expect(rankBroadcasts({...match,startedAt:null},[row])[0].suggestedOffset).toBeNull();expect(rankBroadcasts(match,[{...row,start:'2026-10-27T11:00:00Z'}])[0].suggestedOffset).toBeNull()})
 it('handles a broadcast spanning local midnight and rejects the wrong day',()=>{expect(rankBroadcasts({...match,startedAt:'2026-10-27T22:00:00Z'},[{...row,start:'2026-10-27T20:00:00Z',end:'2026-10-28T01:00:00Z'}])).toHaveLength(1);expect(rankBroadcasts(match,[{...row,start:'2026-10-26T08:00:00Z',end:'2026-10-26T20:00:00Z'}])).toHaveLength(0)})
 it('does not suggest an offset after a stream ended',()=>{expect(rankBroadcasts(match,[{...row,end:'2026-10-27T10:00:00Z'}])[0].suggestedOffset).toBeNull()})
 it('validates explicit replay positions',()=>{expect(parseReplayTime('02:17:30')).toBe(8250);expect(parseReplayTime('02:67:30')).toBeNull();expect(parseReplayTime('-1')).toBeNull()})
})
