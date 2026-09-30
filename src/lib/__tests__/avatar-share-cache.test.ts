// @vitest-environment jsdom
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {avatarShareFile} from '../avatar-share'
const fetchImage=vi.fn()
beforeEach(()=>{
 vi.stubGlobal('fetch',fetchImage);fetchImage.mockReset().mockResolvedValue({ok:true,blob:async()=>new Blob(['image'])})
 vi.stubGlobal('Image',class{src='';decode(){return Promise.resolve()}})
 vi.stubGlobal('URL',Object.assign(class {},{createObjectURL:()=> 'blob:test',revokeObjectURL:vi.fn()}))
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation((()=>({fillRect:vi.fn(),drawImage:vi.fn(),getImageData:()=>({data:new Uint8ClampedArray(720*1080*4)}),putImageData:vi.fn()})) as never)
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>cb(new Blob(['png'],{type:'image/png'})))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
function avatar(){const host=document.createElement('div');host.innerHTML='<svg><image href="/play/body.webp"/><image href="/play/body.webp"/></svg>';return host.querySelector('svg')!}
it('fetches each layer once and reuses rendering across formats and repeated opens',async()=>{const svg=avatar();const first=await avatarShareFile(svg);expect(fetchImage).toHaveBeenCalledTimes(1);expect(await avatarShareFile(svg)).toBe(first);await avatarShareFile(svg,'portrait');expect(fetchImage).toHaveBeenCalledTimes(1)})
it('invalidates the cache when the equipped artwork changes',async()=>{const svg=avatar();const first=await avatarShareFile(svg);svg.querySelector('image')!.setAttribute('href','/play/new.webp');expect(await avatarShareFile(svg)).not.toBe(first);expect(fetchImage).toHaveBeenCalledTimes(3)})
it('allows a retry after a failed layer download',async()=>{const svg=avatar();fetchImage.mockResolvedValueOnce({ok:false});await expect(avatarShareFile(svg)).rejects.toThrow();await expect(avatarShareFile(svg)).resolves.toHaveProperty('name','padel-nachos-full.png')})
it('caches court and transparent exports separately without refetching the avatar',async()=>{const svg=avatar();const court=await avatarShareFile(svg,'full','court');const transparent=await avatarShareFile(svg,'full','transparent');expect(transparent).not.toBe(court);expect(await avatarShareFile(svg,'full','court')).toBe(court);expect(fetchImage).toHaveBeenCalledTimes(1)})
