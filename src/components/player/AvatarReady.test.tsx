// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {act,cleanup,render} from '@testing-library/react'
import {AvatarReady} from './AvatarReady'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('waits for outfit images before revealing and deduplicates matching assets',async()=>{
 const images:{onload:()=>void}[]=[]
 vi.stubGlobal('Image',class {onload=()=>{};set src(_:string){images.push(this)}})
 const {container}=render(<><AvatarReady identity="one"><svg><image href="/test-avatar-unique.webp"/></svg></AvatarReady><AvatarReady identity="two"><svg><image href="/test-avatar-unique.webp"/></svg></AvatarReady></>)
 expect(images).toHaveLength(1)
 expect(container.querySelectorAll('[style="opacity: 0;"]').length).toBe(2)
 await act(async()=>{images[0].onload()})
 expect(container.querySelectorAll('[style="opacity: 1;"]').length).toBe(2)
})
it('reveals the character even when an optional accessory fails',async()=>{
 const images:{onload:()=>void;onerror:()=>void}[]=[]
 vi.stubGlobal('Image',class {onload=()=>{};onerror=()=>{};set src(_:string){images.push(this)}})
 const {container}=render(<AvatarReady identity="missing-accessory"><svg><image href="/base-test.webp"/><image href="/missing-hat-test.webp"/></svg></AvatarReady>)
 await act(async()=>{images[0].onload();images[1].onerror()})
 expect(container.querySelector('[style="opacity: 1;"]')).not.toBeNull()
})
