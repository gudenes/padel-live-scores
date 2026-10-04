// @vitest-environment jsdom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {PairIdentity} from './PlayerIdentity'
vi.mock('next/image',()=>({default:(props:React.ImgHTMLAttributes<HTMLImageElement>)=>React.createElement('img',props)}))
vi.mock('@/i18n/navigation',()=>({Link:({href,children,...props}:any)=><a href={href} {...props}>{children}</a>}))
afterEach(cleanup)
const player={id:'player-1',name:'Nuria Cánovas',surname:'Cánovas',avatarUrl:null,country:null,ranking:null,raceRanking:null,winRate:null,totalMatches:null,titles:null,form:null}
it('shows the same initials fallback used by match details when a photo is missing',()=>{
 render(<PairIdentity players={[player]}/>);expect(screen.getByRole('img',{name:'Nuria Cánovas'}).textContent).toBe('NC')
})
it('replaces a failed photo with initials',()=>{
 render(<PairIdentity players={[{...player,avatarUrl:'/missing-photo.png'}]}/>);fireEvent.error(screen.getByAltText('Nuria Cánovas'));expect(screen.getByRole('img',{name:'Nuria Cánovas'}).textContent).toBe('NC')
})

it('links known player identities but never invents a profile for a missing id',()=>{
 const {rerender}=render(<PairIdentity players={[player]}/>);
 expect(screen.getByRole('link',{name:player.name}).getAttribute('href')).toBe('/player/player-1');
 rerender(<PairIdentity players={[{...player,id:null}]}/>);expect(screen.queryByRole('link')).toBeNull()
})
