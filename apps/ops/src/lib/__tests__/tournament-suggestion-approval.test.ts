// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import TournamentSuggestions from '../../app/(app)/play/markets/_components/TournamentSuggestions'
const preview={question:{en:'Will A / B win Germany?',es:'¿Ganará A / B Alemania?'},rules:{en:'YES if the pair wins. Otherwise NO. Refund if unresolved.'},probability:.4,locksAt:'2099-10-06T10:00:00Z',maxLoss:5000,priceSource:'Model today',errors:[]}
const suggestion={id:'pick',config:{family:'champion',category:'men'},reason:'Title favourite',preview,existingMarketId:null}
const initial={events:[{id:'germany',name:'Germany P2',starts_at:'2099-10-05'}],tournamentId:'germany',suggestions:[suggestion],publishingEnabled:true}
const draft={id:'draft',revision:1,preview,preview_token:'token',preview_expires_at:'2099-10-06T09:00:00Z'}
const calls:Record<string,unknown>[]=[]
let publishError=false, expires='2099-10-06T09:00:00Z', existing:string|null=null
beforeEach(()=>{
 calls.length=0;publishError=false;expires='2099-10-06T09:00:00Z';existing=null
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
 HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{
  if(!options?.method)return {ok:true,json:async()=>({...initial,suggestions:[{...suggestion,existingMarketId:existing}]})}
  const body=JSON.parse(String(options.body));calls.push(body)
  if(body.action==='publish')return {ok:!publishError,json:async()=>publishError?{error:'The evidence or price changed. Preview again.'}:{marketId:'published'}}
  return {ok:true,json:async()=>({draft:{...draft,preview_expires_at:expires}})}
 }))
})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('operator approval flow',()=>{
 it('does not save or publish on load; publishes only the reviewed draft after explicit approval',async()=>{
  const onPublished=vi.fn();render(createElement(TournamentSuggestions,{onPublished}))
  const card=await screen.findByRole('button',{name:'Review & approve'})
  expect(calls).toEqual([])
  fireEvent.click(card)
  await waitFor(()=>expect((screen.getByRole('button',{name:'Approve & publish'}) as HTMLButtonElement).disabled).toBe(false))
  expect(calls.map(c=>c.action)).toEqual(['save','preview'])
  expect(screen.getByText(preview.rules.en)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'Approve & publish'}))
  await screen.findByText('Published: Will A / B win Germany?')
  expect(calls[2]).toEqual({action:'publish',id:'draft',revision:1,token:'token'})
  expect(onPublished).toHaveBeenCalledOnce()
 })
 it('disables an expired preview instead of publishing it',async()=>{
  expires='2000-01-01T00:00:00Z';render(createElement(TournamentSuggestions,{onPublished:vi.fn()}))
  fireEvent.click(await screen.findByRole('button',{name:'Review & approve'}))
  await screen.findByText('This preview has expired. Refresh it before approving.')
  expect((screen.getByRole('button',{name:'Approve & publish'}) as HTMLButtonElement).disabled).toBe(true)
  expect(calls.some(c=>c.action==='publish')).toBe(false)
 })
 it('shows changed evidence without claiming success or closing the review',async()=>{
  publishError=true;const onPublished=vi.fn();render(createElement(TournamentSuggestions,{onPublished}))
  fireEvent.click(await screen.findByRole('button',{name:'Review & approve'}))
  await waitFor(()=>expect((screen.getByRole('button',{name:'Approve & publish'}) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button',{name:'Approve & publish'}))
  await screen.findByRole('alert');expect(onPublished).not.toHaveBeenCalled()
  expect(screen.getByRole('button',{name:'Refresh preview'})).toBeTruthy()
 })
 it('marks existing markets as published and prevents another approval',async()=>{
  existing='already';render(createElement(TournamentSuggestions,{onPublished:vi.fn()}))
  const button=await screen.findByRole('button',{name:'Already published'})
  expect((button as HTMLButtonElement).disabled).toBe(true);expect(calls).toEqual([])
 })
})
