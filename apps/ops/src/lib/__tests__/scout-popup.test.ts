// @vitest-environment jsdom
import {createElement} from 'react'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
import ScoutLaunchMenu from '../../app/(scouting)/scouting/ScoutLaunchMenu'
import ScoutPopupLink from '../../app/(scouting)/scouting/ScoutPopupLink'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('opens the authorized live route and reuses the open window without reloading it',()=>{
 const popup={closed:false,focus:vi.fn(),opener:window}
 const open=vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window)
 render(createElement(ScoutPopupLink,{matchId:'match-id'}))
 const link=screen.getByRole('link',{name:'Open scouting in pop-up'})
 expect(fireEvent.click(link)).toBe(false)
 expect(open).toHaveBeenCalledWith('/scouting/match-id/live','padel-scout-match-id',expect.stringContaining('popup=yes'))
 expect(popup.opener).toBeNull()
 fireEvent.click(link);expect(open).toHaveBeenCalledTimes(1);expect(popup.focus).toHaveBeenCalledTimes(2)
})
it('preserves ordinary navigation when blocked or when modifier keys are used',()=>{
 const open=vi.spyOn(window,'open').mockReturnValue(null)
 render(createElement(ScoutPopupLink,{matchId:'match-id'}))
 const link=screen.getByRole('link',{name:'Open scouting in pop-up'})
 expect(fireEvent.click(link)).toBe(true)
 expect(link.getAttribute('href')).toBe('/scouting/match-id/live')
 expect(fireEvent.click(link,{ctrlKey:true})).toBe(true)
 expect(open).toHaveBeenCalledTimes(1)
})

it('offers both destinations with keyboard navigation and Escape dismissal',()=>{
 render(createElement(ScoutLaunchMenu,{matchId:'match-id',continuing:true}))
 const trigger=screen.getByRole('button',{name:'Scouting window options'})
 expect(screen.queryByRole('menu')).toBeNull()
 fireEvent.click(trigger)
 const same=screen.getByRole('menuitem',{name:'Same window'})
 expect(document.activeElement).toBe(same)
 fireEvent.keyDown(same,{key:'ArrowDown'})
 expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Pop-up window'}))
 fireEvent.keyDown(document.activeElement!,{key:'Escape'})
 expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(trigger)
 fireEvent.click(trigger);fireEvent.pointerDown(document.body)
 expect(screen.queryByRole('menu')).toBeNull()
})
