'use client'
import { useEffect, useState } from 'react'
import { Panel, Button } from '@/components/ui'
type Status = { enabled:boolean;configured:boolean;suffix:string|null }
export default function AvatarSettings() {
  const [status,setStatus]=useState<Status|null>(null)
  const [key,setKey]=useState('')
  const [enabled,setEnabled]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  useEffect(()=>{let active=true;fetch('/api/internal/avatar-settings').then(async r=>{if(!r.ok)throw Error();return r.json()}).then(s=>{if(active){setStatus(s);setEnabled(s.enabled)}}).catch(()=>{if(active)setMessage('Local avatar settings are unavailable.')});return()=>{active=false}},[])
  async function action(action:'save'|'remove'|'test') {
    setBusy(true);setMessage('')
    try {
      const response=await fetch('/api/internal/avatar-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...(action==='save'?{enabled,...(key.trim()?{apiKey:key.trim()}:{})}:{})})})
      const result=await response.json()
      if(!response.ok)throw new Error(result.error || 'Could not update settings.')
      setStatus(result);setEnabled(result.enabled);setKey('');setMessage(result.message || (action==='remove'?'Key removed. Photo avatars are disabled.':'Saved. The avatar app uses these settings immediately.'))
    }catch(error){setMessage(error instanceof Error?error.message:'Could not update settings.')}
    finally{setBusy(false)}
  }
  return <Panel><div style={{display:'grid',gap:16}}>
    <div><h2 style={{fontSize:16,fontWeight:700,margin:0}}>Avatar generation · OpenAI</h2><p style={{color:'var(--text-2)',fontSize:12,margin:'6px 0 0'}}>Local preview only. Controls photo-to-avatar generation in Play.</p></div>
    <label style={{display:'flex',gap:10,alignItems:'center',fontSize:13}}><input type="checkbox" checked={enabled} disabled={!status||busy} onChange={e=>setEnabled(e.target.checked)}/> Enable photo avatars locally</label>
    <div style={{fontSize:12,color:'var(--text-2)'}}>OpenAI key: <strong>{status?.configured?`Saved · ••••${status.suffix}`:'Not configured'}</strong></div>
    <label style={{display:'grid',gap:7,fontSize:12}}> {status?.configured?'Replace API key':'Add API key'}
      <input type="password" autoComplete="new-password" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} disabled={!status||busy} placeholder="sk-…" style={{padding:12,background:'var(--bg-2)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-1)',width:'100%'}}/>
    </label>
    <p style={{fontSize:12,color:'var(--text-2)',margin:0}}>Saved keys cannot be revealed here. Leave the field empty to keep the saved key. Credentials are encrypted in local files outside Git; they are never stored in the shared feature-flags table.</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Button disabled={busy||!status} onClick={()=>action('save')}>Save settings</Button><Button disabled={busy||!status?.configured} onClick={()=>action('test')}>Check connection</Button><Button disabled={busy||!status?.configured} onClick={()=>action('remove')}>Remove key</Button></div>
    <div role="status" style={{fontSize:12,color:'var(--text-2)'}}>{busy?'Working…':message}</div>
  </div></Panel>
}
