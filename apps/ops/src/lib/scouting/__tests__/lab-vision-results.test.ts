import {describe,it,expect} from 'vitest'
import {viewerAssets,validateViewerManifest} from '../../lab-vision-results'
const setup={duration:180,matchStart:20,analysisSeconds:60,offset:18881,playerNames:['a','b','c','d'],playerIds:['1','2','3','4']}
const manifest=()=>({version:1,partial:true,sourceDimensions:[1920,1080],start:20,end:80,duration:180,broadcastOffset:18881,chunks:2,chunkSeconds:60,coverage:[[20,30,1]],inverseHomography:[[1,0,0],[0,1,0],[0,0,1]],players:setup.playerNames.map((name,i)=>({key:`p${i}`,name,id:setup.playerIds[i],team:Math.floor(i/2)})),performance:Object.fromEntries(setup.playerNames.map((_,i)=>[`p${i}`,{distance_m:10,max_speed_kmh:12,average_speed_kmh:3}]))})
describe('viewer publication',()=>{
 it('requires all expected assets exactly once',()=>{const a={version:1,assets:[{file:'manifest.json',size:100},{file:'000.json',size:100},{file:'001.json',size:100}]};expect(viewerAssets(a,80)).toHaveLength(3);expect(()=>viewerAssets({...a,assets:a.assets.slice(1)},80)).toThrow();expect(()=>viewerAssets({...a,assets:[a.assets[0],a.assets[1],a.assets[1]]},80)).toThrow()})
 it('rejects paths and overlarge files',()=>{expect(()=>viewerAssets({version:1,assets:[{file:'../manifest.json',size:100},{file:'000.json',size:100}]},50)).toThrow();expect(()=>viewerAssets({version:1,assets:[{file:'manifest.json',size:30*1024*1024},{file:'000.json',size:100}]},50)).toThrow()})
 it('binds timing and identities to the confirmed setup',()=>{expect(validateViewerManifest(manifest(),setup)).toBeTruthy();for(const change of [{start:0},{broadcastOffset:0},{players:manifest().players.slice().reverse()},{end:180}])expect(()=>validateViewerManifest({...manifest(),...change},setup)).toThrow()})
 it('rejects invalid calibration and coverage',()=>{for(const change of [{inverseHomography:[[NaN,0,0],[0,1,0],[0,0,1]]},{coverage:[[0,30,1]]},{coverage:[[70,200,1]]}])expect(()=>validateViewerManifest({...manifest(),...change},setup)).toThrow()})
 it('preserves unknown speed',()=>{const m=manifest();m.performance.p0.max_speed_kmh=null as any;expect(validateViewerManifest(m,setup).performance.p0.max_speed_kmh).toBeNull()})
})
