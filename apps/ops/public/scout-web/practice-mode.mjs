// Practice uses the same controls, but never the installed extension transport.
export const playground = new URL(globalThis.location?.href??"http://localhost/").searchParams.has('playground');
export function memoryStorage(){
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
export const preferences = playground ? memoryStorage() : {getItem:key=>globalThis.localStorage?.getItem(key)??null,setItem:(key,value)=>globalThis.localStorage?.setItem(key,value),removeItem:key=>globalThis.localStorage?.removeItem(key)};
export function practiceMessageAllowed(type){return !['sync-server','load-server','sign-in','account-status','open-video','open-video-link'].includes(type);}
