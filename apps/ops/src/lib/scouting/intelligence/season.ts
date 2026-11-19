export function currentSeason(date=new Date()){return new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Europe/Madrid'}).format(date)}
export function seasonParams(input:URLSearchParams){const result=new URLSearchParams(input);if(!result.has('year'))result.set('year',currentSeason());return result}
