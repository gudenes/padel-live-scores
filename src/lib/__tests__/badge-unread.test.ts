import {describe,it,expect} from 'vitest'
import {countUnreadBadges} from '@/hooks/useBadgeUnread'
const first={badge_id:'follow_players',tier:1,unlocked_at:'2026-09-28'}
describe('badge notifications',()=>{
 it('counts an unseen unlock',()=>expect(countUnreadBadges([first],null)).toBe(1))
 it('clears a viewed badge',()=>expect(countUnreadBadges([first],JSON.stringify(['follow_players:1']))).toBe(0))
 it('flags a new tier of an existing badge',()=>expect(countUnreadBadges([first,{...first,tier:2}],JSON.stringify(['follow_players:1']))).toBe(1))
 it('does not mistake a different badge at the same tier for one already viewed',()=>expect(countUnreadBadges([{...first,badge_id:'first_pick'}],JSON.stringify(['follow_players:1']))).toBe(1))
 it('handles corrupt stored state without breaking profile',()=>expect(countUnreadBadges([first],'{')).toBe(0))
})
