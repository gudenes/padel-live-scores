// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import RedbullReviewPlayer from '../../app/(scouting)/scouting/[id]/report/view/RedbullReviewPlayer';
afterEach(()=>vi.unstubAllGlobals());
it('reloads the embed for a different point and a repeated click on the same point',async()=>{
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host);
 const url='https://www.redbull.tv/es_ES/page/rrn:content:live-videos:f0ee7f41-1e0e-4abd-a4d2-b84d89a29f21/finals';
 const render=(time:number,serial:number)=>act(async()=>root.render(React.createElement(RedbullReviewPlayer,{url,command:{time,serial}})));
 try{
  await render(0,0);
  const first=host.querySelector('iframe');
  await render(22197,1);
  const second=host.querySelector('iframe');
  expect(second).not.toBe(first);
  expect(second?.src).toContain('?time=22197');
  await render(22197,2);
  expect(host.querySelector('iframe')).not.toBe(second);
  expect(host.querySelector('iframe')?.src).toBe(second?.src);
  expect(host.textContent).not.toContain('Connect Scout');
  expect(host.textContent).toContain('reloads briefly');
 }finally{await act(async()=>root.unmount())}
});
