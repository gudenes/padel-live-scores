// @vitest-environment jsdom
import {it,expect,vi} from 'vitest'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import ReplayPlayer from '../../app/(scouting)/scouting/[id]/report/view/ReplayPlayer'
it('honors a point chosen before YouTube is ready and seeks again without recreating the player',async()=>{
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 let ready:()=>void=()=>{};const seek=vi.fn(),play=vi.fn(),destroy=vi.fn(),created=vi.fn()
 window.YT={Player:class{constructor(_node:HTMLElement,options:any){created();ready=options.events.onReady}seekTo=seek;playVideo=play;destroy=destroy;getCurrentTime=()=>0;getDuration=()=>100} as any}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const source={kind:'youtube' as const,id:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk'};const render=(time:number,serial:number)=>React.createElement(ReplayPlayer,{source,command:{time,serial},loop:null,onTime:()=>{}})
 try{await act(async()=>{root.render(render(39,1))});await act(async()=>{root.render(render(97,2))});await act(async()=>ready());expect(seek).toHaveBeenLastCalledWith(97,true);expect(play).toHaveBeenCalledTimes(1);await act(async()=>{root.render(render(39,3))});expect(seek).toHaveBeenLastCalledWith(39,true);expect(created).toHaveBeenCalledTimes(1)}finally{await act(async()=>root.unmount());host.remove();delete window.YT;vi.unstubAllGlobals()}
})
