export const quickShots=[
 ['q','smash'],['w','volley'],['e','vibora'],
 ['a','bandeja'],['s','groundstroke'],['d','lob'],
 ['1','chiquita'],['2','block'],['3','bajada'],
];
export const extraShots=[
 ['t','rulo'],['g','gancho'],['v','drop'],
 ['5','wall'],['6','return'],
 ['shift+d','contrapared'],['0','other'],
];
export const allShotShortcuts=[...quickShots,...extraShots];
export const shotShortcut=e=>(e.shiftKey?'shift+':'')+e.key.toLowerCase();
export const shortcutLabel=key=>key.startsWith('shift+')?'⇧'+key.slice(6).toUpperCase():key.toUpperCase();
