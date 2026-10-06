const fs=require('node:fs'),path=require('node:path');
const ts=require('../../apps/ops/node_modules/typescript');
for(const name of ['scoring','score-label','shots']){
 const source=fs.readFileSync(path.join(__dirname,'../../apps/ops/src/lib/scouting',name+'.ts'),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replaceAll("'./scoring'","'./scoring.mjs'");
 fs.writeFileSync(path.join(__dirname,'generated',name+'.mjs'),'// Generated from admin scouting. Run node extensions/scouting-video-companion/sync-scoring.cjs\n'+output);
}
