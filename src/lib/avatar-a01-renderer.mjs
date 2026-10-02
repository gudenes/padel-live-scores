import fittedSources from './avatar-a01-fitted.json' with {type:'json'};
import rosterProfiles from './avatar-a01-roster.json' with {type:'json'};
/** A01 pilot. One registered source per body; all views and PNG export share this renderer. */
export const collections = ['starter','club','cobalt','sunset','champion'];
export const slots = ['shirt','shorts','shoes','wrist','racket'];
export const hats = ['starter','club','cobalt','sunset','champion','backwards','bandana'];
export const profiles = {
 ...rosterProfiles,
 'face-06': {name:'Beltrán', portrait:'310 45 430 445',
  shirt:'M414 376 Q510 447 630 389 L693 419 L765 605 L697 621 L710 823 L340 823 L372 606 L290 579 L322 450Z',
  shorts:'M310 770H745V1055H310Z',
  wrist:'M695 745 L797 714 L840 834 L724 865Z',
  shoes:'M210 1290H430V1490H210Z M575 1290H870V1490H575Z',
  racket:'M189 670 Q259 645 300 711 Q339 779 300 866 L332 904 L312 929 L276 888 Q196 926 142 889 Q85 868 96 799 Q95 714 189 670Z',
  cap:[371,36,312,210], visor:[380,110,295,110], bandana:[362,145,308,82],
  panels:'M375 1332 Q392 1330 401 1353 L411 1414 L382 1426 L368 1380Z M606 1318 Q638 1308 667 1334 L714 1390 L676 1417 L609 1385Z',
  soles:'M210 1426 Q310 1458 432 1423V1495H210Z M575 1408 Q701 1470 870 1413V1495H575Z'
 },
 'face-01': {name:'Brisa', portrait:'230 25 525 445',
  shirt:'M443 365 Q527 429 628 390 L680 410 L760 558 L689 584 L701 760 Q561 795 360 746 L384 586 L308 542 L330 449 Q370 405 443 365Z',
  shorts:'M330 730H765V970H330Z',
  wrist:'M695 745 L800 714 L840 836 L724 870Z',
  shoes:'M225 1305H435V1500H225Z M605 1305H885V1500H605Z',
  racket:'M85 584H275L311 718L316 823L282 853L237 818H85Z',
  cap:[388,10,305,210], visor:[405,98,280,109], bandana:[383,121,271,83],
  panels:'M381 1340 Q398 1330 410 1360 L419 1430 L387 1443 L371 1392Z M630 1330 Q666 1312 701 1339 L750 1402 L696 1432 L635 1398Z',
  soles:'M220 1443 Q322 1472 438 1440V1510H220Z M600 1430 Q741 1483 890 1431V1510H600Z'
 }
};
const palette={
 starter:['#fffaf1','#343537','#faf9f4','#252629','#28292c'],
 club:['#ff7627','#147987','#91df21','#94db28','#72c929'],
 cobalt:['#1263f2','#182f58','#1769f6','#1467e5','#165ae4'],
 sunset:['#f36c56','#ded4bc','#ee6957','#f36a54','#ef6453'],
 champion:['#343536','#303133','#dcb148','#e4b847','#ae8c32']
};
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function normalize(input={}) {return Object.fromEntries([...slots,'hat','sticker'].map(slot=>[slot,(slot==='hat'?hats:slot==='sticker'?['none','king','dejadas']:collections).includes(input[slot])?input[slot]:slot==='sticker'?'none':'starter']));}
export function renderAvatar({avatar='face-06',outfit={},id='a01',base='../',portrait=false,debug=false,images={}}={}) {
 if(!profiles[avatar]) throw new Error('Unknown A01 character');
 const p=profiles[avatar],o=normalize(outfit),prefix=id.replace(/[^a-zA-Z0-9_-]/g,'');
 const src=path=>xml(images[path]??base+path);

 const fittedSource=fittedSources[avatar]?.[o.hat];
 const fitted=Boolean(fittedSource);
 const sourcePath='characters/'+(fittedSource||avatar+'.png');
 const image=(attributes='')=>`<image href="${src(sourcePath)}" width="1024" height="1536" ${attributes}/>`;
 const closedCap=!fitted&&avatar==='face-06'&&['club','champion','backwards'].includes(o.hat);
 const crownPath=avatar==='face-06'?'M370 0H675V135 Q630 108 535 115 Q440 117 378 166Z':'M426 0H698V133 Q620 107 539 113 Q478 115 423 147Z';
 const crownMask=`<mask id="${prefix}-crown-mask"><rect width="1024" height="1536" fill="white"/><path d="${crownPath}" fill="black"/></mask>`;
 const defs=slots.map((slot,i)=>{
  const rgb=palette[o[slot]][i].slice(1).match(/../g).map(x=>parseInt(x,16)/255);
  const gain=['shirt','shoes'].includes(slot)?1.05:slot==='shorts'&&o.shorts==='sunset'?4.5:slot==='wrist'?6:2.8;
  const protect=`<filter id="${prefix}-${slot}-material" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" result="neutral" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 -7 0 7 0 2"/>${slot==='shirt'?'<feColorMatrix in="SourceGraphic" result="fabric" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 2 2 2 0 -2.4"/><feComposite in="neutral" in2="fabric" operator="in"/>':''}${slot==='shorts'?'<feColorMatrix in="SourceGraphic" result="dark" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 -3 -3 -3 0 4"/><feComposite in="neutral" in2="dark" operator="in"/>':''}<feComposite in2="SourceAlpha" operator="in"/></filter><mask id="${prefix}-${slot}-material-mask" mask-type="alpha">${image(`filter="url(#${prefix}-${slot}-material)"`)}</mask>`;
  return protect+`<clipPath id="${prefix}-${slot}"><path d="${p[slot]}"/></clipPath><filter id="${prefix}-${slot}-color" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${rgb.map(v=>`${.2126*v*gain} ${.7152*v*gain} ${.0722*v*gain} 0 0`).join(' ')} 0 0 0 1 0"/></filter>`;
 }).join('');
 // Recolour only the saturated orange starter accents, excluding skin tones.
 const accentMask=`<filter id="${prefix}-accent-material" color-interpolation-filters="sRGB"><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 6 -6 0 0 -2.2"/><feComposite in2="SourceAlpha" operator="in"/></filter><mask id="${prefix}-accent-mask" mask-type="alpha">${image(`filter="url(#${prefix}-accent-material)"`)}</mask>`;
 const shade=(key,hex,gain=1.1)=>{const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255);return `<filter id="${prefix}-${key}" color-interpolation-filters="sRGB"><feColorMatrix values="${rgb.map(v=>`${.2126*v*gain} ${.7152*v*gain} ${.0722*v*gain} 0 0`).join(' ')} 0 0 0 1 0"/></filter>`};
 const trimColour=(slot)=>o[slot]==='champion'?'#e9bb4e':slot==='shorts'&&o[slot]==='sunset'?'#f47760':slot==='shorts'&&o[slot]==='cobalt'?'#3277ef':'#fff2dc';
 const racketFace=p.racketFace || (avatar==='face-06'?'M179 697 Q238 669 282 714 Q321 766 286 843 Q265 892 203 894 Q138 891 119 844 Q103 781 140 733Z':'M168 621 Q234 591 267 639 Q307 697 274 772 Q255 817 195 820 Q133 818 119 770 Q102 708 137 658Z');
 const racketDetail=['club','champion'].includes(o.racket)?image(`data-detail="racket-face" clip-path="url(#${prefix}-racket-face)"`):'';
 const detailDefs=shade('coral-visor','#f36c56',5.4)+accentMask+`<clipPath id="${prefix}-racket-face"><path d="${racketFace}"/></clipPath>`+['shirt','shorts','shoes'].map(slot=>shade(slot+'-trim',slot==='shoes'&&o.shoes==='champion'?'#e9bb4e':trimColour(slot),2.2)).join('')+shade('shoe-panel','#33383c')+`<clipPath id="${prefix}-panels"><path d="${p.panels}"/></clipPath><clipPath id="${prefix}-soles"><path d="${p.soles}"/></clipPath>`;
 const trim=['shirt','shorts','shoes'].filter(slot=>o[slot]!=='starter').map(slot=>image(`data-detail="${slot}-trim" clip-path="url(#${prefix}-${slot})" mask="url(#${prefix}-accent-mask)" filter="url(#${prefix}-${slot}-trim)"`)).join('');
 const panels=['club','champion'].includes(o.shoes)?`<g clip-path="url(#${prefix}-shoes)">${image(`data-detail="shoe-panels" clip-path="url(#${prefix}-panels)" filter="url(#${prefix}-shoe-panel)"`)}</g>`:'';
 const soles=o.shoes==='starter'?'':`<g clip-path="url(#${prefix}-shoes)">${image(`data-detail="shoe-soles" clip-path="url(#${prefix}-soles)"`)}</g>`;
 let headwear='';
 if(o.hat!=='starter'&&!fitted){
  let crop='805 700 449 430',rect=p.cap,path='wardrobe/'+o.hat+'.png',size=[1254,1254];
  if(o.hat==='club')rect=[p.cap[0]+p.cap[2]*.04,p.cap[1]+p.cap[3]*.04,p.cap[2]*.96,p.cap[3]*.96];
  if(['cobalt','sunset'].includes(o.hat)){crop='85 195 1380 680';rect=p.visor;path='wardrobe/visor-three-quarter-v2.png';size=[1536,1024];}
  if(o.hat==='backwards'){path='wardrobe/reverse-three-quarter-v2.png';crop='35 265 1185 740';rect=p.backwards||(avatar==='face-06'?[365,40,300,175]:[399,20,274,173]);}
  if(o.hat==='bandana'){path='wardrobe/special-headwear.png';crop='660 510 594 340';rect=p.bandana;}
  const tilt=o.hat==='backwards'?(p.backwardsTilt??-5):o.hat==='bandana'?-5:0;
  headwear=`<g transform="rotate(${tilt} ${rect[0]+rect[2]/2} ${rect[1]+rect[3]/2})"><svg x="${rect[0]}" y="${rect[1]}" width="${rect[2]}" height="${rect[3]}" viewBox="${crop}" preserveAspectRatio="none"><image ${o.hat==='sunset'?`filter="url(#${prefix}-coral-visor)"`:``} href="${src(path)}" width="${size[0]}" height="${size[1]}"/></svg></g>`;
 }
 const contactDefs=`<mask id="${prefix}-body-alpha" mask-type="alpha">${image()}</mask><filter id="${prefix}-hat-contact" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dy="4"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .22 0"/></filter>`;
 const contact=headwear?`<g mask="url(#${prefix}-body-alpha)"><g filter="url(#${prefix}-hat-contact)">${headwear}</g></g>`:'';
 const layers=slots.map(slot=>o[slot]==='starter'?'':image(`clip-path="url(#${prefix}-${slot})" filter="url(#${prefix}-${slot}-color)" mask="url(#${prefix}-${slot}-material-mask)"`)).join('');
 const lightning=o.shirt==='starter'?'':`<path d="M611 463 L577 507 H596 L582 544 L623 493 H604Z" fill="${o.shirt==='champion'?'#e7bd54':'#fff2d8'}" opacity=".95"/>`;
 const outlines=debug?slots.map((slot,i)=>`<path d="${p[slot]}" fill="none" stroke="${['red','cyan','magenta','yellow','lime'][i]}" stroke-width="3"/>`).join('')+Array.from({length:16},(_,i)=>`<path d="M0 ${i*100}H1024" stroke="#f00" opacity=".3"/><text x="10" y="${i*100+20}" fill="red" font-size="20">${i*100}</text>`).join(''):'';
 const sticker=o.sticker==='none'||portrait?'':`<image href="${src('stickers/'+o.sticker+'.webp')}" x="744" y="72" width="250" height="250"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${portrait?p.portrait:'0 0 1024 1536'}" width="${portrait?600:1024}" height="${portrait?600:1536}" data-avatar-renderer="a01" data-portrait-crop="${p.portrait}" role="img" aria-label="${xml(p.name)} outfit"><defs>${defs}${detailDefs}${crownMask}${contactDefs}</defs>${image(closedCap?`mask="url(#${prefix}-crown-mask)"`:``)}${layers}${racketDetail}${panels}${soles}${trim}${lightning}${contact}${headwear}${sticker}${outlines}</svg>`;
}
