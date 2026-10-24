import {it,expect} from 'vitest'
import {benchmarks,courtPosition} from '../benchmarks'
import type {Match,Person} from '../model'
const players=Array.from({length:4},(_,i)=>({id:String(i),category:'men',side:'right'} as Person))
const match={id:'m',players,partial:false,manual:false,winner:'a',points:Array(100),impact:[100,6,9,15],stats:players.map(()=>({winners:12,unforced:5,smashes:10,smashWinners:4})),deciders:[{rule:'star-point',total:3,a:2,b:1},{rule:'golden-point',total:2,a:1,b:1}],breaks:{a:{won:2,total:4,saved:3,faced:4},b:{won:1,total:4,saved:2,faced:4}}} as unknown as Match
it('pools opportunities and counts pairs once, excluding selected player',()=>{
 const b=benchmarks([match],[players[0]])
 expect(b.players).toBe(3)
 expect(b.impact).toMatchObject({value:10,numerator:30,denominator:3})
 expect(b.winners).toMatchObject({value:12,numerator:36,denominator:300})
 expect(b.breaks).toEqual({value:25,numerator:1,denominator:4})
 expect(b.saved).toEqual({value:50,numerator:2,denominator:4})
 expect(b.star.numerator).toBe(1)
 expect(b.star.denominator).toBe(3)
 expect(b.star.value).toBeCloseTo(100/3)
 expect(b.smash.value).toBe(40)
 expect(b.unforced.value).toBe(5)
})
it('excludes partial, in-progress, manual and other categories',()=>{
 expect(benchmarks([{...match,partial:true},{...match,winner:null},{...match,manual:true}],[players[0]]).matches).toBe(0)
 expect(benchmarks([match],[{...players[0],category:'women'}]).smash.value).toBeNull()
})

it('compares individual actions only with the same position, independently of handedness',()=>{
 const roster=players.map((p,i)=>({...p,side:i===2?'forehand':i===3?null:'backhand',hand:i===2?'left':'right'}))
 const b=benchmarks([{...match,players:roster}],[roster[0]])
 expect(b.position).toBe('left')
 expect(b.players).toBe(1)
 expect(b.impact.value).toBe(6)
 expect(b.winners.denominator).toBe(100)
 expect(b.breaks.denominator).toBe(4)
 expect(courtPosition('drive')).toBe('right')
 expect(courtPosition('both')).toBeNull()
})
it('does not fall back to all positions when the selected position is unknown or has no peers',()=>{
 const unknown=benchmarks([match],[{...players[0],side:null}])
 expect(unknown.impact.value).toBeNull()
 expect(unknown.winners.value).toBeNull()
 expect(unknown.players).toBe(0)
 expect(unknown.breaks.value).toBe(25)
 expect(benchmarks([match],[{...players[0],side:'left'}]).smash.value).toBeNull()
})
