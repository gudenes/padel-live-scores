export function adminReportUrl(match){return match?.id?location.origin+'/scouting/'+encodeURIComponent(match.id)+'/report':null}
