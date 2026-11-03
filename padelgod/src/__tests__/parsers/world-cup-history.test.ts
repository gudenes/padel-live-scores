import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHistoricalPodiums,parseHistoricalMatches,normalizeHistoricalGender,parseHistoricalMedia } from '../../parsers/world-cup-history.js';
const fixture=(name:string)=>readFileSync(`src/__tests__/fixtures/world-cup-history/${name}.html`,'utf8');
describe('historical World Cup archive',()=>{
 it('preserves all editions and the unplayed 2018 final without mixing pairs',()=>{
  const rows=parseHistoricalPodiums(fixture('honours'));
  expect(rows).toHaveLength(34);expect(new Set(rows.map(r=>r.edition_year)).size).toBe(17);
  expect(rows.find(r=>r.edition_year===2018&&r.category==='men')?.payload.gold).toBe('Final not played');
  expect(rows.every(r=>r.edition_year<=2024)).toBe(true);
 });
 it('recovers archived women cards and retains match IDs and scores',()=>{
  const rows=parseHistoricalMatches(fixture('oop'),fixture('results'),2024,1);
  expect(rows).toHaveLength(2);expect(rows.every(r=>r.category==='women')).toBe(true);
  expect(rows[0]?.external_id).toBe('LD031');expect(rows[0]?.payload.result).toBeTruthy();
 });
 it('does not guess categories for unknown prefixes or replace explicit headings',()=>{
  const html='<table class="w-100"><div class="round-name">Women Final</div><a class="open" data-id="MD999"></a></table>';
  expect(normalizeHistoricalGender(html)).not.toContain('Men Women');
  expect(parseHistoricalMatches(fixture('oop').replaceAll('LD0','XX0'),'',2024,1)).toHaveLength(0);
 });
 it('keeps replays without a live badge or future start time and deduplicates videos',()=>{
  const card='<div class="bw-yt-item"><a data-yt="abcdefghijk" data-title="Spain vs Argentina"><span class="bw-yt-tags">Women Final</span></a></div>';
  const rows=parseHistoricalMedia(card+card,2024);
  expect(rows).toHaveLength(1);expect(rows[0]?.kind).toBe('replay');expect(rows[0]?.category).toBe('women');
 });
});
