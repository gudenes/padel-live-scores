import {it,expect,vi} from 'vitest'
// @ts-expect-error Existing jsdom runtime dependency has no bundled declarations.
import {JSDOM} from 'jsdom'
// @ts-expect-error Generated browser adapter exercised directly.
import {impactChart} from '../../../public/scout-web/live-extension/impact-chart.mjs'
it.each([320,520,720])('fits chart labels and plot inside a %ipx panel',width=>{
 const dom=new JSDOM('<body/>');vi.stubGlobal('document',dom.window.document)
 try{
  Object.defineProperty(dom.window.document.documentElement,'clientWidth',{value:width});
  const chart=impactChart({analysis:{series:[{number:1,values:[1,-1,0,2]},{number:2,values:[2,-2,0,3]}]},points:[{before:{sets:[{}]}},{before:{sets:[{}]}}],names:['Bautista','Bergamini','Capra','Sánchez'],identity:(i:number)=>{const span=document.createElement('span');span.textContent='Player '+i;return span}})
  const svg=chart.querySelector('svg'),box=svg.getAttribute('viewBox').split(' ').map(Number),expected=Math.max(260,Math.min(600,width-44));
  expect(box[2]).toBe(expected);expect(box[3]).toBe(Math.max(200,Math.round(expected*.55)))
  for(const label of svg.querySelectorAll('text')){expect(Number(label.getAttribute('x'))).toBeLessThan(box[2]);expect(Number(label.getAttribute('y'))).toBeLessThan(box[3])}
  expect(chart.querySelectorAll('.live-impact-legend>div')).toHaveLength(4)
 }finally{vi.unstubAllGlobals();dom.window.close()}
})
