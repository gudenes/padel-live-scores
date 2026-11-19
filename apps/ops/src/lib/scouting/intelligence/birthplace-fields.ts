// Namespace INE region codes by country; these are not ISO subdivision codes.
export const birthRegions: Record<string,string> = {
  'ES:01':'Andalucía', 'ES:02':'Aragón', 'ES:03':'Asturias', 'ES:04':'Illes Balears',
  'ES:05':'Canarias', 'ES:06':'Cantabria', 'ES:07':'Castilla y León', 'ES:08':'Castilla-La Mancha',
  'ES:09':'Catalunya', 'ES:10':'Comunitat Valenciana', 'ES:11':'Extremadura', 'ES:12':'Galicia',
  'ES:13':'Comunidad de Madrid', 'ES:14':'Región de Murcia', 'ES:15':'Navarra', 'ES:16':'País Vasco',
  'ES:17':'La Rioja', 'ES:18':'Ceuta', 'ES:19':'Melilla',
}
export const birthStatuses: Record<string,string> = {proposed:'Proposed match',verified:'Verified',missing:'Missing birthplace',unresolved:'Unresolved',ambiguous:'Ambiguous'}
export const birthFieldOptions: Record<string,Record<string,string>> = {birth_region:birthRegions,birth_status:birthStatuses}
