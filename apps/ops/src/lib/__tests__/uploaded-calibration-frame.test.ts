// @vitest-environment jsdom
import {createElement} from 'react'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import Wizard from '@/app/(scouting)/scouting/[id]/report/view/VideoUploadWizard'
import type {VideoSetup} from '@/lib/scouting/video-setup'
const players=['A One','B Two','C Three','D Four']
const setup:VideoSetup={version:1,file:{name:'match.mp4',size:100,lastModified:123},duration:100,matchStart:0,calibrationTime:0,offset:1000,scoutingAnchor:{rallyId:'rally',sourceTime:1000,videoTime:0},recording:'broadcast',points:[{x:.2,y:.2},{x:.8,y:.2},{x:.9,y:.9},{x:.1,y:.9},{x:.15,y:.5},{x:.85,y:.5},{x:.3,y:.3},{x:.6,y:.3},{x:.3,y:.7},{x:.6,y:.7}],identities:['0','1','2','3'],playerNames:players,source:'manual',confirmed:true}
const hostedVideo={id:'video',name:'match.mp4',size:100,url:'https://storage.example/match.mp4',offset:1000,duration:100,expiresAt:Date.now()+86400000}
const fetcher=vi.fn(),complete=vi.fn()
beforeEach(()=>{
 complete.mockReset();fetcher.mockReset();vi.stubGlobal('localStorage',{getItem:vi.fn(),setItem:vi.fn()});vi.stubGlobal('fetch',fetcher)
 HTMLDialogElement.prototype.showModal=vi.fn(function(this:HTMLDialogElement){this.open=true})
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{})
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as any)
 vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,frame')
 fetcher.mockImplementation(async(url:string)=>({ok:true,json:async()=>url.endsWith('/setup')?{points:setup.points,landmarks:{version:1,points:{},coordinateSpace:'normalized-image',method:'astra'},notes:''}:{ok:true}}))
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
function open(){
 const view=render(createElement(Wizard,{players,initialOffset:0,initialSetup:setup,hostedVideo,videoId:hostedVideo.id,onClose:vi.fn(),onComplete:complete,firstScouted:{id:'rally',start:1000,label:'First point'}}))
 const video=view.container.querySelector('video')!
 Object.defineProperties(video,{duration:{value:100},readyState:{value:2},videoWidth:{value:1920},videoHeight:{value:1080}})
 fireEvent.loadedMetadata(video);fireEvent.loadedData(video)
 return video
}
it('replaces the uploaded calibration frame without changing the start or uploading a file',async()=>{
 const video=open()
 expect(video.getAttribute('src')).toBe(hostedVideo.url);expect(video.crossOrigin).toBe('anonymous')
 expect(screen.queryByText('Choose video')).toBeNull()
 fireEvent.click(screen.getByText('Choose another frame'))
 video.currentTime=4;fireEvent.timeUpdate(video)
 fireEvent.click(screen.getByText('Use frame & detect'))
 await screen.findByRole('button',{name:'Player A: needs confirmation'})
 for(let i=0;i<4;i++){
  fireEvent.click(screen.getByRole('button',{name:`Player ${String.fromCharCode(65+i)}: needs confirmation`}))
  fireEvent.click(screen.getByText(players[i]))
 }
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.click(screen.getByText('Continue'))
 fireEvent.click(screen.getByText('Save setup & open video'))
 await waitFor(()=>expect(complete).toHaveBeenCalledTimes(1))
 const [file,offset,saved]=complete.mock.calls[0]
 expect(file).toBeNull();expect(offset).toBe(1000)
 expect(saved).toMatchObject({file:setup.file,matchStart:0,calibrationTime:4,scoutingAnchor:setup.scoutingAnchor,offset:1000,confirmed:true})
 expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/api/internal/lab-vision/setup','/api/internal/lab-vision/calibration'])
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({videoId:'video',setup:saved})
})
it('keeps the editor open when saving the uploaded calibration fails',async()=>{
 open();fireEvent.click(screen.getByText('Continue'))
 fetcher.mockResolvedValueOnce({ok:false,json:async()=>({error:'Save failed'})})
 fireEvent.click(screen.getByText('Save setup & open video'))
 await screen.findByText('Save failed');expect(complete).not.toHaveBeenCalled()
})
