import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterMatches,filterTournaments} from '../catalog-ui.mjs';
const matches=[{id:'men',names:['Agustín Tapia','Arturo Coello','Jon Sanz','Franco Stupaczuk'],category:'men',round:'Final',status:'completed'},{id:'women',names:['Ariana Sánchez','Paula Josemaría','Andrea Ustero','Beatriz González'],category:'women',round:'Semi-final',status:'completed'}];
test('player search ignores accents, punctuation, order and extra whitespace',()=>{
 assert.deepEqual(filterMatches(matches,'  coello, AGUSTIN   ').map(m=>m.id),['men']);
 assert.deepEqual(filterMatches(matches,'josemaria sanchez').map(m=>m.id),['women']);
 assert.equal(filterMatches(matches,'Tapia unknown').length,0);
});
test('draw filter keeps men separate from women, and combines with round and player',()=>{
 assert.deepEqual(filterMatches(matches,'','men').map(m=>m.id),['men']);
 assert.deepEqual(filterMatches(matches,'ariana','women','Semi-final').map(m=>m.id),['women']);
 assert.equal(filterMatches(matches,'ariana','women','Final').length,0);
});
test('tournament search includes country, city, level and year',()=>{
 const tournaments=[{id:'a',name:'CUPRA Premier Padel',location:'Málaga',country:'Spain',level:'p2',startsAt:'2025-07-01'},{id:'b',name:'FIP Gold Spain',level:'fip_gold'}];
 assert.deepEqual(filterTournaments(tournaments,'2025 malaga p2',true).map(t=>t.id),['a']);
 assert.equal(filterTournaments(tournaments,'spain',true).length,1);
 assert.equal(filterTournaments(tournaments,'spain',false).length,2);
});
