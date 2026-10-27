import {it,expect,vi} from 'vitest'
// @ts-expect-error Browser JavaScript module is exercised directly in this runtime test.
import {seekLiveCommand} from '../../../public/scout-web/live-player-commands.mjs'
it('routes extension skip and replay controls without inventing DVR bounds',()=>{const current={time:20,seeking:false,tabId:0,documentId:'s',videoId:'v',mediaId:'v'},seek=vi.fn(),bridge={snapshot:()=>current,seek};const state={pending:null,rallies:[{id:'r',start:{...current,time:12}}]};seekLiveCommand(state,bridge,{type:'skip',seconds:-5});expect(seek).toHaveBeenLastCalledWith(15);seekLiveCommand(state,bridge,{type:'replay',id:'r'});expect(seek).toHaveBeenLastCalledWith(9);expect(()=>seekLiveCommand({...state,pending:{}},bridge,{type:'skip',seconds:5})).toThrow('Finish');expect(()=>seekLiveCommand(state,{...bridge,snapshot:()=>({...current,documentId:'new'})},{type:'replay',id:'r'})).toThrow('different video')})

it('replays saved YouTube points after reopening the same video, without altering rallies',()=>{
 const start={time:42,tabId:0,documentId:'old',videoId:'abcdefghijk',mediaId:'youtube:abcdefghijk'},state={pending:null,rallies:[{id:'point',start}]};const original=structuredClone(state);const seek=vi.fn();const bridge={seek,snapshot:()=>({...start,time:100,documentId:'new',seeking:false})};seekLiveCommand(state,bridge,{type:'replay',id:'point'});expect(seek).toHaveBeenCalledWith(39);expect(state).toEqual(original);expect(()=>seekLiveCommand(state,{...bridge,snapshot:()=>({...bridge.snapshot(),videoId:'different'})},{type:'replay',id:'point'})).toThrow('different video');
})

it('continues from the saved end without changing scoring state',()=>{const current={time:100,seeking:false,videoId:'abcdefghijk',mediaId:'youtube:abcdefghijk',documentId:'new',tabId:0};const state={pending:null,rallies:[{id:'r',start:{...current,documentId:'old',time:20},end:{time:37}}]};const original=structuredClone(state),seek=vi.fn(),bridge={snapshot:()=>current,seek};seekLiveCommand(state,bridge,{type:'replay',id:'r',position:'end'});expect(seek).toHaveBeenCalledWith(37);expect(state).toEqual(original);expect(()=>seekLiveCommand({...state,pending:{}},bridge,{type:'replay',id:'r',position:'end'})).toThrow('Finish');})

it('skips 90 seconds using the video clock and refuses to seek during a rally',()=>{
 const seek=vi.fn(),bridge={snapshot:()=>({time:120,seeking:false}),seek}
 seekLiveCommand({pending:null},bridge,{type:'skip',seconds:90});expect(seek).toHaveBeenCalledWith(210)
 expect(()=>seekLiveCommand({pending:{id:'r'}},bridge,{type:'skip',seconds:90})).toThrow('Finish or cancel')
 expect(seek).toHaveBeenCalledTimes(1)
})
