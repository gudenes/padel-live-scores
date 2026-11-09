import {afterEach,describe,expect,it,vi} from 'vitest';
import {syncVideoFrames} from '../video-frame-sync';
class Video extends EventTarget {
 currentTime=10; paused=false; ended=false;
 next=0; callbacks=new Map<number,VideoFrameRequestCallback>();
 requestVideoFrameCallback=vi.fn((cb:VideoFrameRequestCallback)=>{const id=++this.next;this.callbacks.set(id,cb);return id});
 cancelVideoFrameCallback=vi.fn((id:number)=>{this.callbacks.delete(id)});
 frame(t:number){const [id,cb]=this.callbacks.entries().next().value!;this.callbacks.delete(id);cb(0,{mediaTime:t} as VideoFrameCallbackMetadata)}
}
afterEach(()=>vi.unstubAllGlobals());
describe('video frame sync',()=>{
 it('uses every presented frame instead of stale currentTime and cleans up',()=>{
  const v=new Video(),send=vi.fn(),stop=syncVideoFrames(v as unknown as HTMLVideoElement,send);
  v.frame(10.033);v.frame(10.067);
  expect(send.mock.calls.map(c=>c[0])).toEqual([10,10.033,10.067]);
  stop();expect(v.callbacks.size).toBe(0);v.dispatchEvent(new Event('play'));expect(send).toHaveBeenCalledTimes(3);
 });
 it('snaps to pause/seek and follows actual media timestamps at any playback rate',()=>{
  const v=new Video(),send=vi.fn(),stop=syncVideoFrames(v as unknown as HTMLVideoElement,send);
  v.paused=true;v.currentTime=12;v.dispatchEvent(new Event('pause'));expect(send).toHaveBeenLastCalledWith(12);
  v.currentTime=5;v.dispatchEvent(new Event('seeked'));v.frame(5);expect(send).toHaveBeenLastCalledWith(5);
  v.paused=false;v.dispatchEvent(new Event('ratechange'));v.frame(5.067);expect(send).toHaveBeenLastCalledWith(5.067);expect(v.callbacks.size).toBe(1);stop();
 });
 it('falls back to animation frames and stops polling when paused',()=>{
  let callback:FrameRequestCallback|undefined;const raf=vi.fn((cb:FrameRequestCallback)=>{callback=cb;return 1});
  vi.stubGlobal('requestAnimationFrame',raf);vi.stubGlobal('cancelAnimationFrame',vi.fn());
  const v=new EventTarget() as EventTarget&{currentTime:number;paused:boolean;ended:boolean};Object.assign(v,{currentTime:1,paused:false,ended:false});
  const send=vi.fn(),stop=syncVideoFrames(v as HTMLVideoElement,send);v.currentTime=1.04;callback!(0);expect(send).toHaveBeenLastCalledWith(1.04);
  v.paused=true;v.dispatchEvent(new Event('pause'));const count=raf.mock.calls.length;v.currentTime=3;v.dispatchEvent(new Event('seeked'));expect(send).toHaveBeenLastCalledWith(3);expect(raf).toHaveBeenCalledTimes(count);stop();
 });
});
