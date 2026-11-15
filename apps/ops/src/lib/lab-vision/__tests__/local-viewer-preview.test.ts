import {it,expect,vi,afterEach} from 'vitest';
const {readFile}=vi.hoisted(()=>({readFile:vi.fn()}));
vi.mock('node:fs/promises',()=>({readFile}));
import {localViewerPreview} from '../local-viewer-preview';
afterEach(()=>{vi.unstubAllEnvs();readFile.mockReset();});
it('cannot activate in production even with an environment path',async()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('LAB_VISION_MOVEMENT_PREVIEW','/preview');expect(await localViewerPreview('job','prefix')).toBeNull();expect(readFile).not.toHaveBeenCalled();});
it('requires the exact job and source publication',async()=>{vi.stubEnv('NODE_ENV','development');vi.stubEnv('LAB_VISION_MOVEMENT_PREVIEW','/preview');readFile.mockResolvedValue(JSON.stringify({jobId:'other',sourcePrefix:'prefix'}));expect(await localViewerPreview('job','prefix')).toBeNull();expect(readFile).toHaveBeenCalledTimes(1);});
it('loads only an explicitly configured matching preview',async()=>{vi.stubEnv('NODE_ENV','development');vi.stubEnv('LAB_VISION_MOVEMENT_PREVIEW','/preview');readFile.mockResolvedValueOnce(JSON.stringify({jobId:'job',sourcePrefix:'prefix',previewRevision:'rev'})).mockResolvedValueOnce(JSON.stringify({movement:{version:1}}));expect(await localViewerPreview('job','prefix')).toEqual({directory:'/preview',revision:'rev',manifest:{movement:{version:1}}});});
