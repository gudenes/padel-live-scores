// @vitest-environment jsdom
import {it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
vi.mock('../../../public/scout-web/live-transport.mjs',()=>({send:async(message:{type:string})=>({ok:true,state:{version:1,label:'',connection:{selected:{videoId:'test'},candidates:[]},pending:null,rallies:[],cancelled:[],setup:{names:['A','B','C','D'],firstServer:0,otherServer:2,rule:'star-point',firstServerUnknown:true,otherServerUnknown:true,onboardingComplete:false},selectedMatch:{id:'072e0102-aff6-4a29-98b1-99740ae29032',names:['A','B','C','D'],players:[{},{},{},{}]}},sample:{time:10,paused:false,ended:false,seeking:false,readyState:4,rate:1,videoId:'test',duration:100},sync:{status:'local'},auth:message.type==='account-status'?{status:'connected',email:'test'}:undefined})}))
it('boots the real scouting panel with a live video adapter',async()=>{
 history.replaceState({},'','/scout-web/panel.html?matchId=072e0102-aff6-4a29-98b1-99740ae29032&liveLab=1')
 document.documentElement.innerHTML=readFileSync('public/scout-web/live-extension/panel.html','utf8').replace(/<!doctype html>/i,'')
 Element.prototype.scrollIntoView=()=>{}
 HTMLDialogElement.prototype.close=function(){this.open=false}
 HTMLDialogElement.prototype.showModal=function(){this.open=true}
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}))
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 // @ts-expect-error Browser JavaScript module is exercised directly in this runtime test.
 await import('../../../public/scout-web/live-extension/panel.mjs')
 expect(document.querySelector('[aria-label="Video controls"]')).toBeTruthy()
 expect(document.querySelector('#skip--5')?.textContent).toContain('−5s')
 expect(document.querySelector('#video-playback')).toBeTruthy()
 expect(document.querySelector('#video-speed')).toBeTruthy()
})

it('keeps extension presentation and video controls as the source of truth',()=>{
 for(const name of ['panel.css','onboarding.css','scout-ui.mjs','onboarding-ui.mjs','media-shortcuts.mjs','shortcut-settings.mjs'])expect(readFileSync('public/scout-web/live-extension/'+name,'utf8')).toBe(readFileSync('../../extensions/scouting-video-overlay/'+name,'utf8'))
 const html=readFileSync('public/scout-web/live-extension/panel.html','utf8')
 expect(html).not.toContain('standalone.css')
 const source=readFileSync('../../extensions/scouting-video-overlay/panel.html','utf8')
 expect(html.match(/<div class="video-toolbar"[\s\S]*?<\/div>/)?.[0]).toBe(source.match(/<div class="video-toolbar"[\s\S]*?<\/div>/)?.[0])
})
