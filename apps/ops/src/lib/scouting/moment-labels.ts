/** Coach-selected review tags, not inferred shot classifications.
 * Themes adapted from public coaching outlines:
 * https://thebandejalab.com/playbook/
 * https://thepadelschool.com/players/competitive-player
 * https://thepadelschool.com/resources/padel-tips/how-to-deal-with-lobs
 */
export const momentLabelGroups = [
 {name:'Game situations',labels:['Serve + first volley','Return of serve','Taking the net','Holding the net','Defending the back court','Recovering position']},
 {name:'Shots & decisions',labels:['Lob selection','Overhead selection','Volley control','Glass defence','Chiquita / low ball','Shot selection']},
 {name:'Movement & partnership',labels:['Split-step & preparation','Pair positioning','Covering the middle','Moving together','Communication','Playing under pressure']},
 {name:'Coaching focus',labels:['Good example','Needs improvement','Discuss with player','Training priority']},
];
export function cleanMomentLabels(value:unknown):string[]{
 if(!Array.isArray(value))return [];
 const seen=new Set<string>();
 return value.filter((v):v is string=>typeof v==='string').map(v=>v.trim().replace(/\s+/g,' ').slice(0,48)).filter(v=>{const key=v.toLowerCase();if(!v||seen.has(key))return false;seen.add(key);return true}).slice(0,12);
}
