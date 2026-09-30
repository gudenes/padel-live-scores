import { spawn } from 'node:child_process'
const children = new Set()
let stopping = false
function stop(code=0) {
  if (stopping) return
  stopping=true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(()=>process.exit(code),3000).unref()
}
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>stop())
function run(args, auxiliary=false) {
  if (stopping) return
  const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env})
  children.add(child)
  let finished=false
  const ended=(code)=>{
    if(finished) return
    finished=true;children.delete(child)
    if(stopping) return
    if(auxiliary) {
      console.warn('[simulation] worker stopped; retrying in 30 seconds')
      setTimeout(()=>run(args,true),30000)
    } else stop(code || 1)
  }
  child.on('error',()=>ended(1))
  child.on('exit',ended)
}
run(['node_modules/next/dist/bin/next','start','-p',process.env.PORT || '3000'])
if (process.env.PLAY_SIMULATION_ENABLED === 'true') run(['scripts/play-simulation/production-worker.mjs'],true)
