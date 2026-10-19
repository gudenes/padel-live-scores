import {describe,it,expect} from 'vitest'
import {compareCall} from '../scoring'
import lesson from '../lesson.json'
describe('training reference',()=>{
 it('aligns the first rally with the confirmed serve cue',()=>{
  expect(lesson.rallies[0].start).toBe(7)
  expect(lesson.rallies[0]).toMatchObject({player:2,outcome:'winner',shot:'volley'})
 })
 it('only offers complete, ordered rallies inside the downloaded clip',()=>{
  expect(new Set(lesson.rallies.map(r=>r.id)).size).toBe(lesson.rallies.length)
  for(const [i,r] of lesson.rallies.entries()){
   expect(r.start).toBeGreaterThanOrEqual(0)
   expect(r.end).toBeGreaterThan(r.start)
   expect(r.end).toBeLessThanOrEqual(1200.012)
   expect(lesson.players[r.player]).toBeDefined()
   if(i)expect(r.start).toBeGreaterThanOrEqual(lesson.rallies[i-1].end)
  }
 })
 it('does not award player or shot agreement for the correct outcome alone',()=>{
  expect(compareCall({player:1,outcome:'winner',shot:'smash'},lesson.rallies[0])).toEqual({player:false,outcome:true,shot:false,correct:1})
  expect(compareCall(lesson.rallies[0],lesson.rallies[0]).correct).toBe(3)
 })
})
