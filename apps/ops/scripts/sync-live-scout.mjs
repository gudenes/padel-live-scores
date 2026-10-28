// Generate the live browser panel from the extension UI. Only transport and local-only copy differ.
import {readdir,readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ops=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(ops,'../../extensions/scouting-video-overlay'),target=path.join(ops,'public/scout-web/live-extension');
await mkdir(target,{recursive:true});
for(const name of await readdir(source))if(/\.(mjs|js|css)$/.test(name))await cp(path.join(source,name),path.join(target,name));
for(const dir of ['assets','generated'])await cp(path.join(source,dir),path.join(target,dir),{recursive:true});
let panel=await readFile(path.join(source,'panel.mjs'),'utf8');
const transport="const transport=demo?(await import('./preview.mjs?sample-points-v1')).send:message=>chrome.runtime.sendMessage(message);";
if(!panel.includes(transport))throw Error('Extension transport changed: review the live adapter generation.');
panel=panel.replace("button.textContent='Replay'","button.textContent='Ir al punto';button.title='Go to 3 seconds before this point. YouTube may limit live replay.'");
panel=panel.replace(transport,"const transport=(await import('../live-transport.mjs')).send;").replace("installedVersion?'v'+installedVersion:'Local preview'","'Live video'");
// Keep browser layout integration separate from the extension's action engine.
const renderAnchor='renderSync(state,cloud,busy,model.points);';
if(!panel.includes(renderAnchor))throw Error('Panel render changed: review workspace projection.');
panel="import {liveWorkspace} from '../live-workspace.mjs';\n"+panel;
panel=panel.replace("let state=null", "const paintWorkspace=liveWorkspace();\nlet state=null");
panel=panel.replace(renderAnchor,renderAnchor+'paintWorkspace();');
await writeFile(path.join(target,'panel.mjs'),panel);
await writeFile(path.join(target,'report-link.mjs'),"export function adminReportUrl(m){return m?.id?'/scouting/'+encodeURIComponent(m.id)+'/report'+(new URL(location.href).searchParams.get('liveLab')==='1'?'?liveReview=1':''):null;}\n");
let html=await readFile(path.join(source,'panel.html'),'utf8');
html=html.replace('old bookmarks stay in your export, but replay in a new playback session is not yet supported.','saved points can be replayed after reconnecting the same video. YouTube may clamp seeks to its live buffer, and timestamps can shift after the broadcast ends.');
html=html.replace('</head>','<link rel="stylesheet" href="local-test.css"><link rel="stylesheet" href="../live-workspace.css"></head>').replace('<body>','<body class="scout-booting"><section id="scout-loading"><h2 id="scout-loading-title">Preparing your scout</h2><p id="scout-loading-status">Connecting to the embedded video…</p><button class="ui-btn" id="scout-loading-retry" hidden>Try again</button></section><p class="local-test-note">Live video test · background saves to local server · Finish scouting to review</p>');
html=html.replace('src="panel.mjs?v=scouting-log1"','src="boot.mjs"');
html=html.replace('Scouting records and calculated scores save to the server when admin is connected. The panel confirms each server save.','Scouting saves in the background. Finish scouting in the video workspace to review.');
await writeFile(path.join(target,'panel.html'),html);
await cp(path.join(ops,'public/scout-web/boot.mjs'),path.join(target,'boot.mjs'));
await writeFile(path.join(target,'local-test.css'),`body.scout-booting>:not(#scout-loading):not(script){display:none!important}#scout-loading{padding:40px 20px;text-align:center}.local-test-note{font-size:12px;padding:8px;border:1px solid var(--lime,#c9f43b);border-radius:8px}#load-server,#closing-sync,#closing-account,#sign-in,#menu-sign-in,#show-overlay,#header-new-match,#switch-match,[data-menu="find"],[data-menu="create"],[data-menu="saved"]{display:none!important}\n`);

// The browser's resizable panel needs readable axis text at narrow widths.
let chart=await readFile(path.join(source,'impact-chart.mjs'),'utf8');
const chartEdits=[
 ["const root=document.createElement('div');", "const chartWidth=Math.max(260,Math.min(600,document.documentElement.clientWidth-44)),chartHeight=Math.max(200,Math.round(chartWidth*.55));const root=document.createElement('div');"],
 ["svg.setAttribute('viewBox','0 0 600 330')", "svg.setAttribute('viewBox',`0 0 ${chartWidth} ${chartHeight}`)"],
 ['left=38,right=530,top=24,bottom=287','left=38,right=chartWidth-70,top=24,bottom=chartHeight-43'],
 ['y:316','y:chartHeight-14'],
 ['box.width*600-left','box.width*chartWidth-left'],
];
for(const [from,to] of chartEdits){if(!chart.includes(from))throw Error('Impact chart changed: review responsive browser layout.');chart=chart.replaceAll(from,to);}
await writeFile(path.join(target,'impact-chart.mjs'),chart);
let stats=await readFile(path.join(source,'live-stats.mjs'),'utf8');
const signature='JSON.stringify([data.timeline,data.names,data.rallies])';
if(!stats.includes(signature))throw Error('Live stats changed: review resize redraw.');
stats=stats.replace(signature,'JSON.stringify([document.documentElement.clientWidth,data.timeline,data.names,data.rallies])');
await writeFile(path.join(target,'live-stats.mjs'),stats);
