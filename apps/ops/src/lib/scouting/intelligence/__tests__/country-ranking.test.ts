import {it,expect} from 'vitest'
import {countryRanking} from '../country-ranking'
import type {Person} from '../model'
const p=(id:string,ranking:number|null,extra:Partial<Person>={}):Person=>({id,ranking,country:'BR',category:'men',name:id,avatar_url:null,...extra})
it('ranks by current global rank within country and category, preserving ties',()=>{
 const player=p('a',20)
 const people=[player,p('b',5),p('c',20),p('d',30),p('e',1,{category:'women'}),p('f',2,{country:'ES'}),p('g',null),p('h',0)]
 expect(countryRanking(player,people)).toEqual({rank:2,total:4})
 expect(countryRanking(p('c',20),people)?.rank).toBe(2)
 expect(countryRanking(player,[...people,p('b',5)])?.total).toBe(4)
})
it('does not invent rankings for missing metadata',()=>{
 expect(countryRanking(p('a',null),[])).toBeNull()
 expect(countryRanking(p('a',20,{country:null}),[])).toBeNull()
 expect(countryRanking(p('a',20,{category:null}),[])).toBeNull()
})
