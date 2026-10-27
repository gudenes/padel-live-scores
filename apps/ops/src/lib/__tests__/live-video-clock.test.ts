import {describe,it,expect} from 'vitest'
import {liveVideoClock,youtubeId} from '../scouting/live-video-clock'
describe('live clock',()=>{
 it('samples actual player time and rejects buffering as capture-ready',()=>{let time=31,status=1,wall=0;const p={getCurrentTime:()=>time,getDuration:()=>100,getPlaybackRate:()=>1,getPlayerState:()=>status};const c=liveVideoClock('abcdefghijk','session',()=>wall);expect(c.sample(p).time).toBe(31);wall=100;time=31.1;expect(c.sample(p).seekEpoch).toBe(0);status=3;expect(c.sample(p).readyState).toBe(0)})
 it('invalidates jumps, seeks and changed playback-session identity',()=>{let time=10,wall=0;const p={getCurrentTime:()=>time,getDuration:()=>100,getPlaybackRate:()=>1,getPlayerState:()=>1};const c=liveVideoClock('abcdefghijk','first',()=>wall);const initial=c.sample(p);wall=200;time=50;expect(c.sample(p)).toMatchObject({seekEpoch:1,seeking:true});wall=1200;time=51;expect(c.sample(p).seeking).toBe(false);c.markSeek();expect(c.sample(p).seekEpoch).toBe(2);expect(liveVideoClock('abcdefghijk','second').sample(p).documentId).not.toBe(initial.documentId)})
 it('does not invent DVR boundaries and handles paused playback',()=>{const p={getCurrentTime:()=>10,getDuration:()=>100,getPlaybackRate:()=>2,getPlayerState:()=>2};let wall=0;const c=liveVideoClock('abcdefghijk','s',()=>wall);c.sample(p);wall=5000;expect(c.sample(p)).toMatchObject({paused:true,seekEpoch:0,seekable:[]})})
 it('rejects impostor URLs and credentials',()=>{expect(youtubeId('https://www.youtube.com/live/abcdefghijk')).toBe('abcdefghijk');expect(youtubeId('https://youtu.be/abcdefghijk?t=20')).toBe('abcdefghijk');expect(youtubeId('https://youtube.com.evil.test/watch?v=abcdefghijk')).toBeNull();expect(youtubeId('https://user@youtube.com/watch?v=abcdefghijk')).toBeNull()})
})

it('existing scoring engine refuses a rally after a seek or reconnect',async()=>{
 const {startRally,finishRally}=await import('../../../../../extensions/scouting-video-overlay/core.mjs')
 let time=10,wall=0;const p={getCurrentTime:()=>time,getDuration:()=>200,getPlaybackRate:()=>1,getPlayerState:()=>1};const c=liveVideoClock('abcdefghijk','first',()=>wall)
 const rally=startRally(c.sample(p),'test','point-1');wall=500;time=10.5;expect(finishRally(rally,c.sample(p)).videoSeconds).toBe(.5)
 c.markSeek();wall=2000;time=50;c.sample(p);wall=3000;time=51;expect(()=>finishRally(rally,c.sample(p))).toThrow('moved')
 expect(()=>finishRally(rally,liveVideoClock('abcdefghijk','new').sample(p))).toThrow('changed')
})
