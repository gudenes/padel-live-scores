/** Matches the published net-depth-5-7-v2 analysis schema. */
export const COURT_ZONES=[{key:'defence',label:'Defence',near:7,far:10,color:'#8da9ed'},{key:'transition',label:'Transition',near:5,far:7,color:'#e2b97d'},{key:'attack',label:'Attack',near:0,far:5,color:'#53d4c5'}] as const;
export function savedPressureIndex(performance:unknown):number|null{
 if(!performance||typeof performance!=='object')return null;
 const score=(performance as Record<string,unknown>).pressure_index;
 return typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100?score:null;
}
export function supportsCourtZones(schema:unknown):boolean{
 if(!schema||typeof schema!=='object')return false;
 const s=schema as Record<string,unknown>;
 return s.version==='net-depth-5-7-v2'&&s.distance_from==='net'&&COURT_ZONES.every(z=>{const range=s[z.key+'_m'];return Array.isArray(range)&&range.length===2&&range[0]===z.near&&range[1]===z.far;});
}
