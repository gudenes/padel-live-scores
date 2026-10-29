// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import RedbullReviewPlayer from '../../app/(scouting)/scouting/[id]/report/view/RedbullReviewPlayer';
import {connectRedbull} from '../scouting/redbull-video-bridge';
import {reviewOffset,reviewTarget} from '../scouting/redbull-review-clock';
vi.mock('../scouting/redbull-video-bridge',()=>({connectRedbull:vi.fn()}));
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals()});
it('maps epoch-based recordings to a relative replay without altering recorded timestamps',()=>{const offset=reviewOffset(1793303900,120);expect(reviewTarget(1793303897,offset,[[0,500]])).toBe(117);expect(()=>reviewTarget(1,null,[[0,500]])).toThrow('Align');expect(()=>reviewTarget(1793305000,offset,[[0,500]])).toThrow('outside');expect(()=>reviewOffset(NaN,0)).toThrow('Choose')});
it('requires explicit alignment, controls the selected point and disconnects on source loss',async()=>{
 vi.useFakeTimers();vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const sample={time:120,paused:true,seekable:[[0,500]],seeking:false};const bridge={capture:vi.fn(async()=>sample),snapshot:()=>sample,seek:vi.fn(async()=>sample),pause:vi.fn(async()=>sample),close:vi.fn()};vi.mocked(connectRedbull).mockResolvedValue(bridge as any);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),onReady=vi.fn(),onTime=vi.fn();let serial=1;let loop:{start:number;end:number}|null=null;
 const render=()=>React.createElement(RedbullReviewPlayer,{url:'https://www.redbull.tv/es_ES/page/rrn:content:live-videos:f5a4e725-eabd-44f7-a22d-3be211e1c65f/kuwait',command:{time:1793303897,serial},loop,pointStart:1793303900,pointNumber:1,onReady,onTime});
 const click=async(text:string)=>act(async()=>{(Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!).click()});
 try{await act(async()=>root.render(render()));await click('Connect Scout');expect(bridge.seek).not.toHaveBeenCalled();serial++;await act(async()=>root.render(render()));expect(bridge.seek).not.toHaveBeenCalled();await click('Align current');expect(onReady).toHaveBeenLastCalledWith(true);expect(onTime).toHaveBeenLastCalledWith(1793303900,0);serial++;await act(async()=>root.render(render()));expect(bridge.seek).toHaveBeenLastCalledWith(117);expect(bridge.pause).toHaveBeenLastCalledWith(false);loop={start:1793303897,end:1793303903};sample.time=124;sample.paused=false;await act(async()=>root.render(render()));bridge.seek.mockClear();await act(async()=>vi.advanceTimersByTimeAsync(500));expect(bridge.seek).toHaveBeenLastCalledWith(117);bridge.capture.mockRejectedValueOnce(Error('The video changed'));await act(async()=>vi.advanceTimersByTimeAsync(500));expect(onReady).toHaveBeenLastCalledWith(false);expect(bridge.close).toHaveBeenCalled();expect(host.textContent).toContain('The video changed')}finally{await act(async()=>root.unmount());host.remove()}
});
it('shared reports only link out and never connect the extension',async()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.mocked(connectRedbull).mockClear();const host=document.createElement('div'),root=createRoot(host);try{await act(async()=>root.render(React.createElement(RedbullReviewPlayer,{url:'https://www.redbull.tv/test',command:{time:0,serial:0},loop:null,pointStart:0,readOnly:true,onReady:()=>{},onTime:()=>{}})));expect(host.querySelector('button')).toBeNull();expect(connectRedbull).not.toHaveBeenCalled()}finally{await act(async()=>root.unmount())}});
