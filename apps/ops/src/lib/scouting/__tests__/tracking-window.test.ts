// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {renderHook,waitFor,cleanup,act} from '@testing-library/react';
import {useTrackingWindow} from '../use-tracking-window';
import type {AnalysisResult} from '../use-analysis-result';
const makeResult=(id:string)=>({id,videoId:id,updatedAt:'1',assetBase:`/${id}/`,manifest:{start:0,end:180,players:[]}} as unknown as AnalysisResult);
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('tracking window loader',()=>{
 it('fetches adjacent chunks once and reuses them for frame updates',async()=>{
  const fetch=vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('manifest.json')?{start:0,end:180}:{rows:[{source_s:60,players:{}}]}}));vi.stubGlobal('fetch',fetch);
  const result=makeResult('window');const {result:r,rerender}=renderHook(({time})=>useTrackingWindow(result,time),{initialProps:{time:60}});
  await waitFor(()=>expect(r.current.loading).toBe(false));expect(fetch).toHaveBeenCalledTimes(4);
  rerender({time:61});expect(fetch).toHaveBeenCalledTimes(4);expect(r.current.rows).toHaveLength(3);
 });
 it('clears stale rows immediately on a seek and permits retry after failure',async()=>{
  let fail=true;vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:!fail,json:async()=>url.endsWith('manifest.json')?{start:0,end:180}:{rows:[{source_s:60,players:{}}]}})));
  const result=makeResult('retry');const {result:r,rerender}=renderHook(({time})=>useTrackingWindow(result,time),{initialProps:{time:60}});
  await waitFor(()=>expect(r.current.error).toBeTruthy());fail=false;act(()=>r.current.retry());await waitFor(()=>expect(r.current.rows).toHaveLength(3));
  rerender({time:250});expect(r.current.rows).toHaveLength(0);await waitFor(()=>expect(r.current.loading).toBe(false));expect(r.current.rows).toHaveLength(0);
 });
 it('does not fetch disabled overlays',()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const {result}=renderHook(()=>useTrackingWindow(makeResult('off'),60,false));expect(fetch).not.toHaveBeenCalled();expect(result.current.rows).toEqual([]);});
});
