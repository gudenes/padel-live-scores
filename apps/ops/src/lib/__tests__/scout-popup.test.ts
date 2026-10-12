// @vitest-environment jsdom
import {createElement} from 'react'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
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
