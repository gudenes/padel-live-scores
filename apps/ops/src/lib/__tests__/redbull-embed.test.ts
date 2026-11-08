import {expect,it} from 'vitest';
import {redbullEmbedUrl} from '../scouting/redbull-embed';
const id='rrn:content:live-videos:f0ee7f41-1e0e-4abd-a4d2-b84d89a29f21';
it('converts the supplied broadcast page to an official embed without tracking or slug',()=>{
 expect(redbullEmbedUrl(`https://www.redbull.tv/es_ES/page/${id}/fip-world-cup-2026-finals-centre-court?cid=event#time`)).toBe(`https://www.redbull.tv/es_ES/embed/${id}`);
 expect(redbullEmbedUrl(`https://redbull.tv/en/page/${id.replace('live-videos','videos')}/replay`)).toBe(`https://www.redbull.tv/en/embed/${id.replace('live-videos','videos')}`);
});
it('never constructs embeds from untrusted hosts or unsupported links',()=>{
 for(const url of [`https://redbull.tv.attacker.com/es_ES/page/${id}`,`https://attacker@www.redbull.tv/es_ES/page/${id}`,`http://www.redbull.tv/es_ES/page/${id}`,`https://www.redbull.tv/es_ES/page/event`, 'javascript:alert(1)'])expect(redbullEmbedUrl(url)).toBeNull();
});
it('uses whole seconds for timestamp jumps and rejects invalid positions',()=>{
 const url=`https://www.redbull.tv/es_ES/page/${id}/finals`;
 expect(redbullEmbedUrl(url,22200.8)).toBe(`https://www.redbull.tv/es_ES/embed/${id}?time=22200`);
 expect(redbullEmbedUrl(url,0)).toContain('?time=0');
 for(const time of [-1,NaN,Infinity])expect(redbullEmbedUrl(url,time)).toBeNull();
});
