import { describe,it,expect,vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next-intl',()=>({useTranslations:()=>((key:string)=>key),useLocale:()=> 'es'}))
import WorldCupStream from '../WorldCupStream'
describe('World Cup language choices',()=>{
 it('offers both broadcasts and defaults to the viewer language',()=>{
  const html=renderToStaticMarkup(<WorldCupStream videoId="abcdefghijk" streams={[{videoId:'abcdefghijk',language:'ENG'},{videoId:'12345678901',language:'ESP'}]} title="Italy – Mexico" open />)
  expect(html).toContain('<select');expect(html).toContain('ENG');expect(html).toContain('ESP')
  expect(html).toContain('youtube.com/embed/12345678901');expect(html).toContain('watch?v=12345678901')
 })
 it('does not load the player until opened',()=>{
  expect(renderToStaticMarkup(<WorldCupStream videoId="abcdefghijk" title="Italy – Mexico" />)).not.toContain('<iframe')
 })
})
