// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import MarketCard from './MarketCard'
import { parseMarkets } from './types'
vi.mock('@/i18n/navigation',()=>({Link:({href,children,...props}:any)=><a href={href} {...props}>{children}</a>}))
vi.mock('next/image',()=>({default:({fill,sizes,...props}:any)=><img {...props}/>}))
afterEach(cleanup)
it('keeps both purchase choices and full-rule details wired for editorial cards',()=>{
 const [market]=parseMarkets({markets:[{id:'ranking',question:'Full official ranking question',priceYes:.25,horizon:'season',book:{qYes:1000*Math.log(.25),qNo:1000*Math.log(.75),b:1000},editorial:{kind:'ranking',target:12,players:[{id:'javi',name:'Javi Leal',photoUrl:'/full.webp',avatarUrl:'/head.png',ranking:15}]}}]})
 const choose=vi.fn(), detail=vi.fn()
 render(<NextIntlClientProvider locale="en" messages={messages}><MarketCard market={market} onChoose={choose} onDetail={detail}/></NextIntlClientProvider>)
 fireEvent.click(screen.getByRole('button',{name:/^Yes ·/}));expect(choose).toHaveBeenLastCalledWith('yes')
 fireEvent.click(screen.getByRole('button',{name:/^No ·/}));expect(choose).toHaveBeenLastCalledWith('no')
 fireEvent.click(screen.getByRole('button',{name:/Details/}));expect(detail).toHaveBeenCalledWith(market)
 const image=screen.getByRole('img',{name:'Javi Leal'});expect(image.getAttribute('src')).toBe('/full.webp')
 fireEvent.error(image);expect(image.getAttribute('src')).toBe('/head.png')
 fireEvent.error(image);expect(screen.getByRole('img',{name:'Javi Leal'}).textContent).toBe('JL')
})
