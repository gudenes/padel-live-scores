import {readdir,copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const ops=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(ops,'../../extensions/scouting-video-overlay'),target=path.join(ops,'public/scout-web');
const overrides=new Set(['panel.mjs','panel.html','scout-ui.mjs','onboarding-ui.mjs','report-link.mjs','practice-mode.mjs','scouting-keys.mjs','shortcut-settings.mjs']);
const excluded=new Set(['background.mjs','preview.mjs','preview-coaches.mjs','content.js','overlay.js','account.mjs','cloud.mjs','local-store.mjs','probe.mjs','public-report.mjs']);
await mkdir(target,{recursive:true});
for(const name of await readdir(source))if((name.endsWith('.mjs')||name.endsWith('.js'))&&!overrides.has(name)&&!excluded.has(name))await copyFile(path.join(source,name),path.join(target,name));
await mkdir(path.join(target,'generated'),{recursive:true});
for(const name of await readdir(path.join(source,'generated')))await copyFile(path.join(source,'generated',name),path.join(target,'generated',name));
// Live video uses the extension's complete presentation, not standalone overrides.
await import('./sync-live-scout.mjs');
