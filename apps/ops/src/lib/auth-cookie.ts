/** Built previews on HTTP loopback must use the same session cookie as local dev. */
export function sessionCookie(production:boolean,authUrl?:string){
 let loopback=false
 try{const url=new URL(authUrl??'');loopback=url.protocol==='http:'&&!url.username&&!url.password&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)}catch{}
 const secure=production&&!loopback
 return {name:secure?'__Secure-authjs.session-token':'authjs.session-token',options:{httpOnly:true,sameSite:'lax' as const,path:'/',secure,domain:secure?'.padelnachos.com':undefined}}
}
