import { load } from 'cheerio';
import { parseCrionetOop, parseOopDayDate } from './crionet-oop.js';
import { parseCrionetResults } from './crionet-results.js';
import { parseWorldCupSquads } from '../workers/world-cup-reconciler.js';
export type ArchiveRecord = {
  edition_year: number; kind: 'podium'|'squad'|'group'|'tie'|'match'|'replay'|'document';
  category: 'men'|'women'|'mixed'; external_id: string; payload: Record<string, unknown>;
};
const clean = (s: string) => s.replace(/\s+/g,' ').trim();
const category = (s: string) => /women|female/i.test(s) ? 'women' as const : /men|male/i.test(s) ? 'men' as const : null;
export function parseHistoricalPodiums(html: string): ArchiveRecord[] {
  const $=load(html), rows: ArchiveRecord[]=[];
  for(const gender of ['men','women'] as const) {
    $(`#roll_world_champions_teams_${gender} tbody tr`).each((_,tr)=>{
      const cells=$(tr).find('td').map((_,td)=>clean($(td).text())).get();
      if(cells.length!==6 || !/^\d{4}$/.test(cells[0]!))return;
      rows.push({edition_year:Number(cells[0]),kind:'podium',category:gender,external_id:'podium',payload:{
        hostCountry:cells[1],hostCity:cells[2],gold:cells[3],silver:cells[4],bronze:cells[5],
        verification:'official-source-transcription',
      }});
    });
  }
  return rows;
}
export function parseHistoricalSquads(html:string,year:number): ArchiveRecord[] {
  return parseWorldCupSquads(html).map(s=>({edition_year:year,kind:'squad',category:s.category as 'men'|'women',external_id:s.country,payload:{country:s.country,players:s.names}}));
}
/** 2024 archived cards omit the women's heading; LD/MD are Crionet draw IDs.
 * Preserve explicit headings and never classify an unknown ID prefix. */
export function normalizeHistoricalGender(html:string):string {
  const $=load(html);
  $('table.w-100').each((_,table)=>{
    const round=$(table).find('.round-name').first();
    if(category(round.text()))return;
    const id=$(table).find('a.open[data-id]').first().attr('data-id')??'';
    const gender=/^LD\d+$/.test(id)?'Women':/^MD\d+$/.test(id)?'Men':null;
    if(gender)round.prepend(`${gender} `);
  });
  return $.html();
}
export function parseHistoricalMatches(oopHtml:string,resultsHtml:string,year:number,day:number):ArchiveRecord[] {
  const results=new Map(parseCrionetResults(normalizeHistoricalGender(resultsHtml),day).map(r=>[r.matchWidgetId,r]));
  return parseCrionetOop(normalizeHistoricalGender(oopHtml),day).filter(m=>m.matchWidgetId).map(m=>({
    edition_year:year,kind:'match' as const,category:m.category!,external_id:m.matchWidgetId!,
    payload:{...m,dayDate:parseOopDayDate(oopHtml,new Date(`${year}-07-01T00:00:00Z`)),categoryEvidence:'Explicit heading or archived Crionet LD/MD draw prefix',result:results.get(m.matchWidgetId)??null,resultCoverage:results.has(m.matchWidgetId)?'available':'not-found'},
  })).filter(m=>m.category==='men'||m.category==='women');
}
export function parseHistoricalGroups(html:string,year:number):ArchiveRecord[] {
  const $=load(html),rows:ArchiveRecord[]=[];
  $('[data-draw]').each((_,draw)=>{
    const gender=category($(draw).find('.h4').first().text());if(!gender)return;
    $(draw).find('.group-caption').each((_,caption)=>{
      const name=clean($(caption).text());
      const teams=$(caption).next('.group-body').children().filter((_,row)=>$(row).find('.group-team').length>0).map((_,row)=>({
        name:clean($(row).find('.group-team').text()),
        country:$(row).find('.group-team img').attr('src')?.match(/\/([A-Z]{2,3})\.jpg/i)?.[1]??null,
        points:clean($(row).find('.group-pts').text()),rubbers:clean($(row).find('.group-rubs').text()),
      })).get();
      const ties=new Map<string,{dateLabel:string;home:string;away:string;score:number[]|null}>();
      $(caption).next('.group-body').find('.tie-date').each((_,date)=>{
        const row=$(date).parent(),names=row.find('.tie-team').map((_,team)=>clean($(team).text())).get();
        if(names.length!==2)return;
        const dateLabel=clean($(date).text()),score=clean(row.find('.tie-score').text()).match(/^(\d+)\s*-\s*(\d+)$/);
        ties.set(`${dateLabel}:${names.join(':')}`,{dateLabel,home:names[0]!,away:names[1]!,score:score?[Number(score[1]),Number(score[2])]:null});
      });
      rows.push({edition_year:year,kind:'group',category:gender,external_id:name,payload:{name,teams,ties:[...ties.values()]}});
    });
  });return rows;
}
export function parseHistoricalTies(html:string,year:number,day:number):ArchiveRecord[] {
  const $=load(html),rows:ArchiveRecord[]=[];
  $('[data-view]').each((_,el)=>{
    const gender=category($(el).children().first().text());if(!gender)return;
    const names=$(el).find('.tie-team-name').map((_,n)=>clean($(n).text())).get();if(names.length!==2)return;
    const body=$(el).find('.card-body');
    const score=clean(body.children('.row').first().text()).match(/\b(\d+)\s*-\s*(\d+)\b/);
    const stage=clean($(el).find('.card-title').text());
    const countries=$(el).find('.tie-flag').map((_,img)=>$(img).attr('src')?.match(/\/([A-Z]{2,3})\.jpg/i)?.[1]??'').get();
    rows.push({edition_year:year,kind:'tie',category:gender,external_id:`${day}:${names.join(':')}:${stage}`,payload:{day,home:names[0],away:names[1],countries,stage,score:score?[Number(score[1]),Number(score[2])]:null}});
  });return rows;
}
export function parseHistoricalMedia(html:string,year:number):ArchiveRecord[] {
  const $=load(html),rows=new Map<string,ArchiveRecord>();
  $('.bw-yt-item a[data-yt]').each((_,a)=>{
    const videoId=$(a).attr('data-yt')??'';if(!/^[\w-]{11}$/.test(videoId))return;
    const tags=clean($(a).find('.bw-yt-tags').text());
    rows.set(videoId,{edition_year:year,kind:'replay',category:category(tags)??'mixed',external_id:videoId,payload:{videoId,title:$(a).attr('data-title')??'',tags,url:`https://www.youtube.com/watch?v=${videoId}`}});
  });
  $('a[href]').each((_,a)=>{
    const url=$(a).attr('href')??'';if(!/^https:\/\/www\.padelfip\.com\/.*\.pdf(?:\?|$)/i.test(url))return;
    rows.set(url,{edition_year:year,kind:'document',category:'mixed',external_id:url,payload:{url,label:clean($(a).text()),coverage:'reference-only-not-transcribed'}});
  });return [...rows.values()];
}
