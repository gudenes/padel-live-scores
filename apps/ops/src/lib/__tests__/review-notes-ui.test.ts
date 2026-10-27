// @vitest-environment jsdom
import {createElement} from 'react'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import ReviewNotes from '@/app/(scouting)/scouting/[id]/report/view/ReviewNotes'
const fetcher=vi.fn(),onSeek=vi.fn()
const context={matchId:'11111111-1111-4111-8111-111111111111',manual:false,userId:'me'}
const props={context,videoUrl:'https://www.youtube.com/watch?v=abcdefghijk',clock:94,onSeek}
const row={id:'note',author_user_id:'me',author_name:'Reviewer',video_url:props.videoUrl,video_seconds:94,tag:'question',note:'Check defense',created_at:'2026-10-27T10:00:00Z'}
beforeEach(()=>{fetcher.mockReset();onSeek.mockReset();vi.stubGlobal('fetch',fetcher);fetcher.mockResolvedValue({ok:true,json:async()=>({notes:[]})})})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('captures playback time, retains a failed draft, and retries with the same ID',async()=>{
 render(createElement(ReviewNotes,props));await screen.findByText('No team review notes yet.')
 fireEvent.click(screen.getByText('Use current time'));expect((screen.getByLabelText('Video timestamp (optional)') as HTMLInputElement).value).toBe('00:01:34')
 fireEvent.change(screen.getByLabelText('Review note'),{target:{value:'Check defense'}})
 fetcher.mockResolvedValueOnce({ok:false,json:async()=>({error:'Offline; please retry.'})})
 fireEvent.click(screen.getByText('Save review note'));await screen.findByText('Offline; please retry.')
 expect((screen.getByLabelText('Review note') as HTMLTextAreaElement).value).toBe('Check defense')
 const first=JSON.parse(fetcher.mock.calls[1][1].body);expect(first.seconds).toBe(94)
 fetcher.mockResolvedValueOnce({ok:true,json:async()=>({note:row})})
 fireEvent.click(screen.getByText('Save review note'));await screen.findByText('Review note saved for the team.')
 expect(JSON.parse(fetcher.mock.calls[2][1].body).id).toBe(first.id)
 expect((screen.getByLabelText('Review note') as HTMLTextAreaElement).value).toBe('')
 fireEvent.click(screen.getByText('Play 00:01:34'));expect(onSeek).toHaveBeenCalledWith(props.videoUrl,94)
})
it('only offers removal of own notes and displays note text safely',async()=>{
 fetcher.mockResolvedValue({ok:true,json:async()=>({notes:[row,{...row,id:'other',author_user_id:'other',note:'<script>alert(1)</script>'}]})})
 render(createElement(ReviewNotes,props));await screen.findByText('<script>alert(1)</script>')
 expect(screen.getAllByText('Remove my note')).toHaveLength(1)
 fetcher.mockResolvedValueOnce({ok:true,json:async()=>({ok:true})})
 fireEvent.click(screen.getByText('Remove my note'));await waitFor(()=>expect(screen.queryByText('Check defense')).toBeNull())
 expect(fetcher.mock.calls.at(-1)?.[1].method).toBe('DELETE')
})
