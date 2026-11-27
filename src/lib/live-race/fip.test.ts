import {describe,it,expect,vi} from 'vitest'
import {fetchFromRoutes,FipFetchError,type FetchAttempt} from './fip'
const html='<span>23/11/2026</span><table id="data-tournament-table"><tbody><tr><td>City</td><td>Test</td><td>FIP GOLD</td><td>01/09/2026</td><td>SF</td><td>50</td></tr></tbody></table>'
const routes=[{id:'fixed_1',url:'http://first'},{id:'fixed_2',url:'http://second'},{id:'residential',url:'http://last'}]
describe('Live Race proxy failover',()=>{
 it('tries other routes when a previously successful fixed proxy starts returning 403',async()=>{
  const request=vi.fn().mockResolvedValueOnce({html,status:200,bytes:200}).mockRejectedValueOnce(new FipFetchError('FIP_HTTP_403',403,40)).mockResolvedValueOnce({html,status:200,bytes:200})
  await fetchFromRoutes('https://www.padelfip.com/player/test/',routes,request)
  const attempts:FetchAttempt[]=[]
  const result=await fetchFromRoutes('https://www.padelfip.com/player/test/',routes,request,async a=>{attempts.push(a)})
  expect(result.results[0].points).toBe(50)
  expect(request.mock.calls.map(c=>c[1])).toEqual(['http://first','http://first','http://second'])
  expect(attempts.map(a=>[a.route,a.httpStatus,a.errorCode])).toEqual([['fixed_1',403,'FIP_HTTP_403'],['fixed_2',200,undefined]])
 })
 it('records every failed attempt when no route succeeds',async()=>{
  const attempts:FetchAttempt[]=[]
  await expect(fetchFromRoutes('url',routes,vi.fn().mockRejectedValue(new FipFetchError('FIP_TIMEOUT')),async a=>{attempts.push(a)})).rejects.toThrow('FIP_TIMEOUT')
  expect(attempts).toHaveLength(3)
  expect(attempts.every(a=>a.errorCode==='FIP_TIMEOUT')).toBe(true)
 })
 it('distinguishes a parse failure from a successful HTTP response',async()=>{
  const attempts:FetchAttempt[]=[]
  await expect(fetchFromRoutes('url',routes.slice(0,1),vi.fn().mockResolvedValue({html:'blocked',status:200,bytes:7}),async a=>{attempts.push(a)})).rejects.toThrow('FIP_PROFILE_PARSE_ERROR')
  expect(attempts[0]).toMatchObject({httpStatus:200,errorCode:'FIP_PROFILE_PARSE_ERROR',bytes:7})
 })
 it('does not hide an unavailable audit sink behind success or fallback',async()=>{
  const request=vi.fn().mockResolvedValue({html,status:200,bytes:200})
  await expect(fetchFromRoutes('url',routes,request,async()=>{throw Error('audit unavailable')})).rejects.toThrow('audit unavailable')
  expect(request).toHaveBeenCalledTimes(1)
 })
})
