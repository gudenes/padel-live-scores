import {it,expect} from 'vitest';
import {apply,createInitialState} from '../scoring';
import type {DeuceRule,TeamId} from '../scoring';
import type {TimelinePoint} from '../tracking';
import {gameCloseness} from '../game-closeness';
function game(sequence:string,rule:DeuceRule='advantage'){
 let s=createInitialState({format:'bo3',goldenPoint:rule==='golden-point',deuceRule:rule,superTiebreak:false,setTiebreakAt:6});
 return [...sequence].map(w=>{const before=s;s=apply(s,{kind:'point_for',team:w as TeamId});return {before,after:s,winner:w} as TimelinePoint});
}
it('distinguishes love, 15 and 30 games',()=>{
 expect(gameCloseness(game('aaaa')).kind).toBe('comfortable');
 expect(gameCloseness(game('abaaa')).reason).toBe('Won to 15');
 expect(gameCloseness(game('aabbaa')).kind).toBe('contested');
});
it('recognizes deuce under each supported rule including repeated advantages',()=>{
 for(const rule of ['advantage','golden-point','star-point'] as const)expect(gameCloseness(game(rule==='golden-point'?'abababa':'abababaa',rule)).kind).toBe('tight');
 expect(gameCloseness(game('abababababaa')).kind).toBe('tight');
});
it('does not classify unfinished, missing or corrected point histories',()=>{
 expect(gameCloseness(game('aaa')).kind).toBe('unknown');
 expect(gameCloseness(game('abaaa').slice(1)).kind).toBe('unknown');
 expect(gameCloseness(game('abaaa').filter((_,i)=>i!==2)).kind).toBe('unknown');
});
it('keeps tiebreaks separate',()=>{
 const p=game('a');p[0].before={...p[0].before,phase:'tiebreak'};
 expect(gameCloseness(p).kind).toBe('tiebreak');
});
