import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
/** Explicit development-only preview; never overrides production publications. */
export async function localViewerPreview(jobId:string,sourcePrefix:string){
 const directory=process.env.LAB_VISION_MOVEMENT_PREVIEW;
 if(process.env.NODE_ENV!=='development'||!directory)return null;
 try{
  const meta=JSON.parse(await readFile(join(directory,'preview.json'),'utf8'));
  if(meta.jobId!==jobId||meta.sourcePrefix!==sourcePrefix)return null;
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  return {directory,manifest,revision:String(meta.previewRevision)};
 }catch{return null;}
}
