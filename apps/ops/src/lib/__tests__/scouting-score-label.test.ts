import {it,expect} from 'vitest'
import {apply,createInitialState} from '../scouting/scoring'
import {scoreLabel} from '../scouting/score-label'
it('labels the complete Star Point cycle and resets after the game',()=>{
 let s=createInitialState({format:'bo3',goldenPoint:false,deuceRule:'star-point',superTiebreak:false,setTiebreakAt:6})
 for(const team of ['a','a','a','b','b','b'] as const)s=apply(s,{kind:'point_for',team})
 expect([scoreLabel(s,'a'),scoreLabel(s,'b')]).toEqual(['D1','D1'])
 s=apply(s,{kind:'point_for',team:'a'});expect(scoreLabel(s,'a')).toBe('Adv1');expect(scoreLabel(s,'b')).toBe('40')
 s=apply(s,{kind:'point_for',team:'b'});expect(scoreLabel(s,'a')).toBe('D2')
 s=apply(s,{kind:'point_for',team:'b'});expect(scoreLabel(s,'b')).toBe('Adv2')
 s=apply(s,{kind:'point_for',team:'a'});expect([scoreLabel(s,'a'),scoreLabel(s,'b')]).toEqual(['SP','SP'])
 s=apply(s,{kind:'point_for',team:'a'});expect(scoreLabel(s,'a')).toBe('0')
 expect(scoreLabel({...s,phase:'tiebreak',currentGame:{a:7,b:7}},'a')).toBe('7')
 expect(scoreLabel({...s,config:{...s.config,deuceRule:'advantage'},currentGame:{a:'Adv',b:40}},'a')).toBe('Adv')
})
