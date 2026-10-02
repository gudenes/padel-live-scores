import {expect,it} from 'vitest'
import {leaderboardWeek} from '../leaderboard-week'
it('rolls over at Monday midnight in Madrid',()=>{
 expect(leaderboardWeek(0,new Date('2026-10-04T21:59:59Z')).start).toBe('2026-09-27T22:00:00.000Z')
 expect(leaderboardWeek(0,new Date('2026-10-04T22:00:00Z')).start).toBe('2026-10-04T22:00:00.000Z')
 expect(leaderboardWeek(1,new Date('2026-10-04T22:00:00Z')).start).toBe('2026-09-27T22:00:00.000Z')
})
it('handles daylight saving without shifting the cutoff',()=>{
 const fall=leaderboardWeek(0,new Date('2026-10-25T12:00:00Z'))
 expect(fall.start).toBe('2026-10-18T22:00:00.000Z');expect(fall.end).toBe('2026-10-25T23:00:00.000Z')
 const spring=leaderboardWeek(0,new Date('2026-03-29T12:00:00Z'))
 expect(spring.start).toBe('2026-03-22T23:00:00.000Z');expect(spring.end).toBe('2026-03-29T22:00:00.000Z')
})
