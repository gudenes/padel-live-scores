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

import { activeLeaderboardWeeks, selectLeaderboardWeek } from '../leaderboard-week'
it('skips inactive weeks while retaining zero-score activity and Madrid week boundaries', () => {
 const now = new Date('2026-11-22T12:00:00Z')
 const weeks = activeLeaderboardWeeks(['2026-11-08T12:00:00Z', '2026-11-08T13:00:00Z', '2026-10-25T23:00:00Z'], now)
 expect(weeks).toEqual([2, 3])
 expect(selectLeaderboardWeek(weeks, 0)).toEqual({weekOffset: 2, previousWeek: 3, nextWeek: null})
 expect(selectLeaderboardWeek(weeks, 3)).toEqual({weekOffset: 3, previousWeek: null, nextWeek: 2})
 expect(selectLeaderboardWeek([], 0)).toEqual({weekOffset: 0, previousWeek: null, nextWeek: null})
})
it('skips gaps in both directions and bounds requests to existing history', () => {
 expect(selectLeaderboardWeek([0, 3, 8], 3)).toEqual({weekOffset: 3, previousWeek: 8, nextWeek: 0})
 expect(selectLeaderboardWeek([0, 3, 8], 1).weekOffset).toBe(3)
 expect(selectLeaderboardWeek([0, 3, 8], 520).weekOffset).toBe(8)
})
