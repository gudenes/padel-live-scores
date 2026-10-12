// @vitest-environment jsdom
import {createElement} from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
// @ts-expect-error The report view is a JavaScript component.
import {DirectionCourt} from '../../app/(scouting)/scouting/[id]/report/view/DirectionCourt'
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('draws the majority label toward Ariana rather than Ustero after an end switch',()=>{
 const ctx=Object.fromEntries(['scale','beginPath','moveTo','quadraticCurveTo','setLineDash','stroke','lineTo','closePath','fill','roundRect','fillText'].map(name=>[name,vi.fn()]));
 ctx.measureText=vi.fn(()=>({width:40}));
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as any);
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1000);
 vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(500);
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 const players=['Andrea Ustero','Ariana Sanchez','Martina Calvo','Claudia Fernandez'].map((name,i)=>({id:String(i),name,avatar:'/player.png'}));
 const rallies=[1,1,1,0].map((receiver,i)=>({id:String(i),start:null,end:null,touches:[{player:2,order:[3,2,1,0]},{player:receiver,order:[3,2,1,0]}]}));
 render(createElement(DirectionCourt,{players,rallies,points:[]}));
 ctx.fillText.mockClear();
 fireEvent.click(screen.getByRole('button',{name:'Select Martina Calvo'}));
 expect(screen.getByRole('img',{name:'Next recorded receiver: Andrea Ustero 25.0%, Ariana Sanchez 75.0%'})).toBeTruthy();
 const majority=ctx.fillText.mock.calls.find(([label])=>label==='75.0%');
 expect(majority).toBeTruthy();expect(majority![1]).toBeLessThan(500);
 const minority=ctx.fillText.mock.calls.find(([label])=>label==='25.0%');
 expect(minority![1]).toBeGreaterThan(500);
});

it('keeps the saved playing sides through an end switch and uses preferred surnames',async()=>{
 const {recordedCourtSlots,compactPlayerName}=await import('../scouting/report-view')
 const rally=(order:number[])=>[{id:'r',start:null,end:null,touches:[{player:1,order}]}]
 const slots=recordedCourtSlots(rally([3,2,1,0]))
 expect(slots[1].x).toBeLessThan(slots[0].x)
 expect(recordedCourtSlots(rally([0,1,2,3]))).toEqual(slots)
 expect(compactPlayerName('Andrea Ustero')).toBe('A. Ustero')
 expect(compactPlayerName('Ari Sanchez')).toBe('A. Sanchez')
 expect(compactPlayerName('Claudia Fernandez')).toBe('C. Fernandez')
})
