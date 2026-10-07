export const quickShots=[
 ['q','smash'],['w','volley'],['e','vibora'],
 ['a','bandeja'],['s','groundstroke'],['d','lob'],
 ['1','chiquita'],['2','block'],['3','bajada'],
];
export const extraShots=[
 ['t','rulo'],['g','gancho'],['v','drop'],
 ['b','half_volley'],['shift+a','wall'],['shift+s','return'],
 ['shift+d','contrapared'],['5','serve'],['6','other'],
];
export const allShotShortcuts=[...quickShots,...extraShots];
export const shotShortcut=e=>(e.shiftKey?'shift+':'')+e.key.toLowerCase();
export const shortcutLabel=key=>key.startsWith('shift+')?'⇧'+key.slice(6).toUpperCase():key.toUpperCase();
