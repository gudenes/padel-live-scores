export const VIDEO_PART_SIZE = 64 * 1024 * 1024
export const MAX_VIDEO_SIZE = 20 * 1024 ** 3
export const videoUuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function parseVideoUpload(b: any) {
  if (!videoUuid.test(b.id ?? '')) throw Error('Invalid upload identifier.')
  if (typeof b.name !== 'string' || !/\.(mp4|webm)$/i.test(b.name) || b.name.length > 240) throw Error('Choose an MP4 or WebM video.')
  if (!Number.isSafeInteger(b.size) || b.size < 1 || b.size > MAX_VIDEO_SIZE) throw Error('Video must be between 1 byte and 20 GB.')
  if (!Number.isFinite(b.offset) || b.offset < -86400 || b.offset > 86400) throw Error('Invalid broadcast offset.')
  if (!Number.isFinite(b.duration) || b.duration <= 0 || b.duration > 86400) throw Error('Check that the video can play before uploading.')
  return {id:b.id as string,name:b.name as string,size:b.size as number,offset:b.offset as number,duration:b.duration as number,type:/\.webm$/i.test(b.name)?'video/webm':'video/mp4'}
}
export function expectedPartSize(size:number,n:number) {
  if (!Number.isInteger(n) || n<1 || n>Math.ceil(size/VIDEO_PART_SIZE)) throw Error('Invalid upload part.')
  return Math.min(VIDEO_PART_SIZE,size-(n-1)*VIDEO_PART_SIZE)
}
export function validateParts(size:number,parts:{PartNumber?:number;Size?:number;ETag?:string}[]) {
  const sorted=[...parts].sort((a,b)=>(a.PartNumber??0)-(b.PartNumber??0))
  if(sorted.length!==Math.ceil(size/VIDEO_PART_SIZE)||sorted.some((p,i)=>p.PartNumber!==i+1||!p.ETag||p.Size!==expectedPartSize(size,i+1))) throw Error('Upload is incomplete. Resume the upload and try again.')
  return sorted.map(p=>({PartNumber:p.PartNumber!,ETag:p.ETag!}))
}
