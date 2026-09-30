// @vitest-environment jsdom
import React from 'react'
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import AvatarShop from '../AvatarShop'
vi.mock('next/image',()=>({default:()=>null}))
vi.mock('next-intl',()=>({useLocale:()=> 'es'}))
const auth=vi.hoisted(()=>({user:null as {id:string}|null,profile:{id:'test',display_name:'Test'},loading:false}))
vi.mock('@/components/AuthProvider',()=>({useAuth:()=>auth}))
vi.mock('@/components/PlayerAvatar',()=>({PlayerAvatar:()=>null}))
vi.mock('@/components/GuacaCoin',()=>({default:()=>null}))
vi.mock('../../AvatarShare',()=>({default:()=>null}))
vi.mock('../../PhotoAvatarCreator',()=>({default:()=>null}))
const KEY='pn:avatar-shop:preview:v1'
beforeEach(()=>{
 vi.useFakeTimers();auth.user=null
 const values=new Map<string,string>()
 vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:vi.fn((key:string,value:string)=>{values.set(key,value)}),clear:()=>values.clear()})
 vi.stubGlobal('React',React)
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({avatars:[]})}))
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
 HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()})
async function openCheckout(){await act(async()=>{render(<AvatarShop/>)});fireEvent.click(screen.getByRole('button',{name:/Comprar · 350/}));}
describe('shop purchase feedback',()=>{
 it('commits once after confirmation, then reveals the saved item',async()=>{
  await openCheckout()
  const confirm=screen.getByRole('button',{name:/Confirmar compra/})
  fireEvent.click(confirm);fireEvent.click(confirm)
  expect(confirm.hasAttribute('disabled')).toBe(true)
  expect(localStorage.getItem(KEY)).toBe(null)
  await act(async()=>{vi.advanceTimersByTime(200)})
  const saved=JSON.parse(localStorage.getItem(KEY)!)
  expect(saved.balance).toBe(8150)
  expect(saved.owned.filter((id:string)=>id==='hat-club')).toHaveLength(1)
  expect(saved.equipped.hat).toBe('hat-club')
  expect(screen.getByText('Añadido a tu vestuario y equipado.')).toBeTruthy()
 })
 it('keeps confirmation available after a storage failure without celebrating',async()=>{
  await openCheckout()
  vi.mocked(localStorage.setItem).mockImplementation(()=>{throw Error('quota')})
  fireEvent.click(screen.getByRole('button',{name:/Confirmar compra/}))
  await act(async()=>{vi.advanceTimersByTime(200)})
  expect(screen.getByRole('alert').textContent).toContain('No se pudo completar la compra')
  expect(screen.queryByText('Añadido a tu vestuario y equipado.')).toBe(null)
  expect(localStorage.getItem(KEY)).toBe(null)
  expect(screen.getByRole('button',{name:/Confirmar compra/}).hasAttribute('disabled')).toBe(false)
 })
 it('cancels without spending or changing the outfit',async()=>{
  await openCheckout()
  fireEvent.click(screen.getByRole('button',{name:'Seguir mirando'}))
  await act(async()=>{vi.runOnlyPendingTimers()})
  expect(localStorage.getItem(KEY)).toBe(null)
 })
})

it('requires sign-in before allowing a profile name save',async()=>{
 await act(async()=>{render(<AvatarShop/>)})
 fireEvent.click(screen.getByRole('button',{name:'Editar nombre'}))
 fireEvent.change(screen.getByLabelText('Nombre visible'),{target:{value:'Bulle7 Bull'}})
 expect(screen.getByText('Inicia sesión para guardar el nombre en tu perfil.')).toBeTruthy()
 expect(screen.getByRole('button',{name:'Guardar nombre'}).hasAttribute('disabled')).toBe(true)
 expect(vi.mocked(fetch).mock.calls.some(([,options])=>options?.method==='PATCH')).toBe(false)
})
it('explains expired sessions and keeps the draft',async()=>{
 auth.user={id:'test'}
 await act(async()=>{render(<AvatarShop/>)})
 fireEvent.click(screen.getByRole('button',{name:'Editar nombre'}))
 fireEvent.change(screen.getByLabelText('Nombre visible'),{target:{value:'Bulle7 Bull'}})
 vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:401} as Response)
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Guardar nombre'}))})
 expect(screen.getByText('Tu sesión ha caducado. Inicia sesión de nuevo para guardar tu nombre.')).toBeTruthy()
 expect((screen.getByLabelText('Nombre visible') as HTMLInputElement).value).toBe('Bulle7 Bull')
})
