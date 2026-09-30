// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({native:vi.fn(),available:vi.fn(),write:vi.fn(),share:vi.fn()}))
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:mocks.native,isPluginAvailable:mocks.available}}))
vi.mock('@capacitor/filesystem',()=>({Directory:{Cache:'CACHE'},Filesystem:{writeFile:mocks.write}}))
vi.mock('@capacitor/share',()=>({Share:{share:mocks.share}}))
import {shareAvatarFile,isAvatarShareCancelled,AvatarShareUpdateRequired} from '../share-avatar-file'
const file=new File(['png'],'padel-nachos-full.png',{type:'image/png'})
beforeEach(()=>{vi.clearAllMocks();mocks.native.mockReturnValue(true);mocks.available.mockReturnValue(true);mocks.write.mockResolvedValue({uri:'file:///cache/avatar-share/full.png'});mocks.share.mockResolvedValue({})})
it('attaches the cached PNG to the native share sheet',async()=>{await shareAvatarFile(file,'data:image/png;base64,cG5n');expect(mocks.write).toHaveBeenCalledWith({path:'avatar-share/full.png',directory:'CACHE',data:'cG5n',recursive:true});expect(mocks.share).toHaveBeenCalledWith({files:['file:///cache/avatar-share/full.png'],title:'Padel Nachos',dialogTitle:'Share avatar'})})
it('requires an app update when the installed binary lacks file support',async()=>{mocks.available.mockReturnValue(false);await expect(shareAvatarFile(file,'')).rejects.toBeInstanceOf(AvatarShareUpdateRequired);expect(mocks.share).not.toHaveBeenCalled()})
it('uses the standard web share sheet without file preparation after the tap',async()=>{mocks.native.mockReturnValue(false);const share=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'share',{value:share,configurable:true});await shareAvatarFile(file,'');expect(share).toHaveBeenCalledWith({files:[file],title:'Padel Nachos'});expect(mocks.write).not.toHaveBeenCalled()})
it('treats dismissing either share sheet as cancellation',()=>{expect(isAvatarShareCancelled(new Error('Share canceled'))).toBe(true);expect(isAvatarShareCancelled(new DOMException('dismissed','AbortError'))).toBe(true);expect(isAvatarShareCancelled(new Error('Cannot write file'))).toBe(false)})
