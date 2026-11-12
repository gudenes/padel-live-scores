export type Landmark={x:number;y:number;heightM?:number;inference?:{method:"floor-geometry";assumption:string}};
export type CourtLandmarks={version:1;points:Record<string,Landmark>;coordinateSpace:'normalized-image';method:'manual'|'astra'|'mixed';reviews?:Record<string,{signature:string;confirmedAt:string}>;backGlass?:{far?:{widthM?:number;heightM?:number};near?:{widthM?:number;heightM?:number}};};
export const landmarks=[
 {id:'net-top-left',label:'Net top · left',group:'Net'}, {id:'net-top-centre',label:'Net top · centre',group:'Net'}, {id:'net-top-right',label:'Net top · right',group:'Net'},
 {id:'service-far-left',label:'Far service line · left',group:'Floor check',world:[0,3.05]}, {id:'service-far-centre',label:'Far service line · centre',group:'Floor check',world:[5,3.05]}, {id:'service-far-right',label:'Far service line · right',group:'Floor check',world:[10,3.05]},
 {id:'service-near-left',label:'Near service line · left',group:'Floor check',world:[0,16.95]}, {id:'service-near-centre',label:'Near service line · centre',group:'Floor check',world:[5,16.95]}, {id:'service-near-right',label:'Near service line · right',group:'Floor check',world:[10,16.95]},
 {id:'glass-far-left',label:'Far back glass · top left',group:'Back glass'}, {id:'glass-far-right',label:'Far back glass · top right',group:'Back glass'},
 {id:'glass-far-bottom-left',label:'Far back glass · bottom left',group:'Back glass'}, {id:'glass-far-bottom-right',label:'Far back glass · bottom right',group:'Back glass'},
 {id:'glass-near-left',label:'Near back glass · top left',group:'Back glass'}, {id:'glass-near-right',label:'Near back glass · top right',group:'Back glass'},
 {id:'glass-near-bottom-left',label:'Near back glass · bottom left',group:'Back glass'}, {id:'glass-near-bottom-right',label:'Near back glass · bottom right',group:'Back glass'},
 {id:'fence-far-left',label:'Far fence upper corner · left',group:'Enclosure'}, {id:'fence-far-right',label:'Far fence upper corner · right',group:'Enclosure'},
 {id:'side-glass-left-far-bottom',label:'Left side glass · far glass/mesh transition · bottom',group:'Side glass'},
 {id:'side-glass-left-far-top',label:'Left side glass · far glass/mesh transition · top',group:'Side glass'},
 {id:'side-glass-left-near-bottom',label:'Left side glass · near glass/mesh transition · bottom',group:'Side glass'},
 {id:'side-glass-left-near-top',label:'Left side glass · near glass/mesh transition · top',group:'Side glass'},
 {id:'door-left-far-bottom',label:'Left doorway · far outer jamb · bottom',group:'Doorways'},
 {id:'door-left-far-top',label:'Left doorway · far outer jamb · top',group:'Doorways'},
 {id:'door-left-near-bottom',label:'Left doorway · near outer jamb · bottom',group:'Doorways'},
 {id:'door-left-near-top',label:'Left doorway · near outer jamb · top',group:'Doorways'},
 {id:'post-left-base',label:'Left net post · base centre',group:'Doorways'},
 {id:'side-glass-right-far-bottom',label:'Right side glass · far glass/mesh transition · bottom',group:'Side glass'},
 {id:'side-glass-right-far-top',label:'Right side glass · far glass/mesh transition · top',group:'Side glass'},
 {id:'side-glass-right-near-bottom',label:'Right side glass · near glass/mesh transition · bottom',group:'Side glass'},
 {id:'side-glass-right-near-top',label:'Right side glass · near glass/mesh transition · top',group:'Side glass'},
 {id:'door-right-far-bottom',label:'Right doorway · far outer jamb · bottom',group:'Doorways'},
 {id:'door-right-far-top',label:'Right doorway · far outer jamb · top',group:'Doorways'},
 {id:'door-right-near-bottom',label:'Right doorway · near outer jamb · bottom',group:'Doorways'},
 {id:'door-right-near-top',label:'Right doorway · near outer jamb · top',group:'Doorways'},
 {id:'post-right-base',label:'Right net post · base centre',group:'Doorways'},
] as const;
export const referenceGroups=['Net','Floor check','Back glass','Side glass','Doorways','Enclosure'] as const;
// A review belongs to the exact geometry reviewed, never just to a populated group.
export function referenceSignature(value:CourtLandmarks,group:string,corners:({x:number;y:number}|null)[]){
 return JSON.stringify({points:landmarks.filter(l=>l.group===group).map(l=>[l.id,value.points[l.id]??null]),corners:corners.slice(0,4).map(p=>p?{x:p.x,y:p.y}:null),dimensions:group==='Back glass'?value.backGlass:null});
}
export function referenceConfirmed(value:CourtLandmarks,group:string,corners:({x:number;y:number}|null)[]){
 return landmarks.some(l=>l.group===group&&value.points[l.id])&&value.reviews?.[group]?.signature===referenceSignature(value,group,corners);
}
export function projectCourt(corners:({x:number;y:number}|null)[],world:number[]){
 if(corners.length<4||corners.slice(0,4).some(p=>!p))return null;
 const worldCorners=[[0,0],[10,0],[10,20],[0,20]],a:number[][]=[];
 for(let i=0;i<4;i++){const [x,y]=worldCorners[i],p=corners[i]!;a.push([x,y,1,0,0,0,-p.x*x,-p.x*y,p.x],[0,0,0,x,y,1,-p.y*x,-p.y*y,p.y])}
 for(let col=0;col<8;col++){let best=col;for(let j=col+1;j<8;j++)if(Math.abs(a[j][col])>Math.abs(a[best][col]))best=j;[a[col],a[best]]=[a[best],a[col]];if(Math.abs(a[col][col])<1e-10)return null;const div=a[col][col];for(let k=col;k<9;k++)a[col][k]/=div;for(let j=0;j<8;j++)if(j!==col){const factor=a[j][col];for(let k=col;k<9;k++)a[j][k]-=factor*a[col][k]}}
 const h=a.map(r=>r[8]),[x,y]=world,den=h[6]*x+h[7]*y+1;if(Math.abs(den)<1e-10)return null;return {x:(h[0]*x+h[1]*y+h[2])/den,y:(h[3]*x+h[4]*y+h[5])/den};
}

export function validLandmarks(value:unknown):value is CourtLandmarks {
 if(!value||typeof value!=='object')return false;
 const v=value as CourtLandmarks;
 if(v.version!==1||v.coordinateSpace!=='normalized-image'||!['manual','astra','mixed'].includes(v.method)||!v.points||typeof v.points!=='object'||Array.isArray(v.points))return false;
 if(!Object.entries(v.points).every(([id,p])=>landmarks.some(l=>l.id===id)&&p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&(p.heightM===undefined||(Number.isFinite(p.heightM)&&p.heightM>=0&&p.heightM<=10))))return false;
 if(v.reviews!==undefined){if(!v.reviews||typeof v.reviews!=='object'||Array.isArray(v.reviews))return false;for(const [group,review] of Object.entries(v.reviews)){if(!referenceGroups.some(g=>g===group)||!review||typeof review.signature!=='string'||review.signature.length>20000||typeof review.confirmedAt!=='string'||!Number.isFinite(Date.parse(review.confirmedAt)))return false;}}
 if(v.backGlass!==undefined){if(!v.backGlass||typeof v.backGlass!=='object'||Array.isArray(v.backGlass))return false;for(const [end,dims] of Object.entries(v.backGlass)){if(!['far','near'].includes(end)||!dims||typeof dims!=='object'||Array.isArray(dims))return false;for(const [key,n] of Object.entries(dims)){if(!['widthM','heightM'].includes(key)||(n!==undefined&&(!Number.isFinite(n)||n<=0||n>20)))return false}}}
 return true;
}


// AI coordinates remain proposals: do not populate measured dimensions from nominal rules.
export function parseAstraLandmarks(raw:unknown):CourtLandmarks {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid reference points');
 const entries=Object.entries(raw);
 if(entries.length!==landmarks.length||entries.some(([id])=>!landmarks.some(l=>l.id===id)))throw Error('Incomplete reference schema');
 const points:Record<string,Landmark>={};
 for(const [id,p] of entries){
  if(p===null)continue;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='x,y')throw Error('Invalid reference coordinate');
  points[id]=p as Landmark;
 }
 const result:CourtLandmarks={version:1,coordinateSpace:'normalized-image',method:'astra',points};
 if(!validLandmarks(result))throw Error('Invalid reference coordinates');
 return result;
}

// Fill only missing floor landmarks. Elevated points require a camera model.
export function inferFloorReferences(corners:({x:number;y:number}|null)[],current:CourtLandmarks,openingSpanM?:number):CourtLandmarks {
 const points={...current.points};
 function add(id:string,world:number[],assumption:string){
  if(points[id])return;
  const p=projectCourt(corners,world);
  if(!p||![p.x,p.y].every(Number.isFinite)||p.x<0||p.x>1||p.y<0||p.y>1)return;
  points[id]={...p,inference:{method:'floor-geometry',assumption}};
 }
 for(const [side,x] of [['left',0],['right',10]] as const){
  for(const [end,y] of [['far',4],['near',16]] as const)add(`side-glass-${side}-${end}-bottom`,[x,y],'FIP side-wall extent: 4 m from back wall; 10 × 20 m floor; verify actual junction.');
  if(openingSpanM!==undefined&&Number.isFinite(openingSpanM)&&openingSpanM>0&&openingSpanM<=5){
   add(`door-${side}-far-bottom`,[x,10-openingSpanM/2],`Assumed outer-jamb span ${openingSpanM} m, centred on net; not clear width or ball clearance.`);
   add(`door-${side}-near-bottom`,[x,10+openingSpanM/2],`Assumed outer-jamb span ${openingSpanM} m, centred on net; not clear width or ball clearance.`);
  }
 }
 return {...current,method:'mixed',points};
}
