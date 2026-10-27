import {videoSource} from './video-review'
export const reviewTags = {note:'Note', highlight:'Highlight', question:'Question', check:'Needs review'} as const
export type ReviewTag = keyof typeof reviewTags
export type ReviewNote = {id:string; author_user_id:string; author_name:string; video_url:string; video_seconds:number|null; tag:ReviewTag; note:string; created_at:string}
export const reviewUuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function parseReviewNote(raw:unknown) {
 if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw Error('Invalid review note.')
 const b=raw as Record<string,unknown>
 if(Object.keys(b).some(k=>!['id','videoUrl','seconds','tag','note'].includes(k))) throw Error('Only review notes and tags can be saved here.')
 if(typeof b.id!=='string'||!reviewUuid.test(b.id)) throw Error('Invalid note identifier.')
 if(typeof b.note!=='string'||!b.note.trim()||b.note.length>2000) throw Error('Enter a note of up to 2,000 characters.')
 if(typeof b.tag!=='string'||!Object.hasOwn(reviewTags,b.tag)) throw Error('Choose a review tag.')
 if(typeof b.videoUrl!=='string'||b.videoUrl.length>2048) throw Error('Invalid video link.')
 const source=b.videoUrl?videoSource(b.videoUrl):null
 if(b.videoUrl&&!source) throw Error('Use a YouTube or direct HTTPS video link.')
 if(b.seconds!==null && (typeof b.seconds!=='number'||!Number.isInteger(b.seconds)||b.seconds<0||b.seconds>86400||!source)) throw Error('A video moment needs a video link and a valid timestamp.')
 return {id:b.id,note:b.note.trim(),tag:b.tag as ReviewTag,videoUrl:source?.url??'',seconds:b.seconds as number|null}
}
