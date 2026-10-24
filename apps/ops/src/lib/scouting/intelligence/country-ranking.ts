import type {Person} from './model'

/** Current database-relative position; not a federation's domestic ranking. */
export function countryRanking(player:Person,people:Person[]){
 const country=player.country?.trim().toUpperCase()
 if(!country||!player.category||!Number.isFinite(player.ranking)||!player.ranking||player.ranking<1)return null
 const peers=[...new Map(people.map(p=>[p.id,p])).values()].filter(p=>
  p.country?.trim().toUpperCase()===country&&p.category===player.category&&
  Number.isFinite(p.ranking)&&Number(p.ranking)>0)
 return {rank:1+peers.filter(p=>Number(p.ranking)<player.ranking!).length,total:peers.length}
}
