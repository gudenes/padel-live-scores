'use client'
import './access.css'
import {useSearchParams} from 'next/navigation'
import {useEffect,useState} from 'react';
type Role='viewer'|'scouter'|'admin';
const roles:Record<Role,{label:string;description:string}>={
 viewer:{label:'Viewer',description:'View all scouted matches, insights and exports. Cannot record or edit matches.'},
 scouter:{label:'Scouter',description:'Record matches, edit assigned sessions and view all scouting insights.'},
 admin:{label:'Administrator',description:'Full admin access, including users, official scores, content and system settings.'}
};
type Person={email:string;role:Role;status:'active'|'suspended';user_id:string|null};
export default function TeamAccess(){
 const[email,setEmail]=useState(''),[role,setRole]=useState<Role>('scouter'),[message,setMessage]=useState('');

 const params=useSearchParams(),matchId=params.get('match'),kind=params.get('kind');
 const[people,setPeople]=useState<Person[]>([]),[admins,setAdmins]=useState<{id:string;email:string}[]>([]);
 const[busy,setBusy]=useState(false),[assignee,setAssignee]=useState('');
 const[editing,setEditing]=useState<string|null>(null),[editRole,setEditRole]=useState<Role>('scouter');
 async function load(){
  const response=await fetch('/api/internal/team-access');const data=await response.json();
  if(!response.ok)throw Error(data.error||'Could not load access.');
  setPeople(data.grants);setAdmins(data.admins);
 }
 useEffect(()=>{void load().catch(e=>setMessage(e.message))},[]);
 async function update(address:string,status:Person['status'],level:Role){
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/internal/team-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:address,status,role:level})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Could not update access.');
   if(data.redirect){window.location.assign(data.redirect);return;}
   setEditing(null);setEmail('');await load();
   setMessage(status==='suspended'?'Access suspended. Local unsynced work stays on their device.':roles[level].label+' access saved. They can sign in with this email; no invitation email has been sent.');
  }catch(e){setMessage(e instanceof Error?e.message:'Could not update access.')}finally{setBusy(false)}
 }
 function add(){
  const address=email.trim().toLowerCase();
  if(people.some(p=>p.email===address)){setMessage('This person already has access. Use Change level below.');return;}
  void update(address,'active',role);
 }
 async function assign(){setBusy(true);try{const r=await fetch('/api/internal/scouting-assignment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId,kind,email:assignee})});const d=await r.json();if(!r.ok)throw Error(d.error);setMessage('Session reassigned. The new scouter should load the server copy before recording.')}catch(e){setMessage(e instanceof Error?e.message:'Could not assign session.')}finally{setBusy(false)}}
 return <section className="access-page">
 <h1>Team access</h1><p className="intro">Choose what each person can do in Padel Nachos.</p>
 <form className="ui-panel access-form" onSubmit={e=>{e.preventDefault();add()}}>
 <div className="access-fields"><label>Email<input className="ui-input" placeholder="person@example.com" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>Access level<select aria-label="Access level" className="ui-input" value={role} onChange={e=>setRole(e.target.value as Role)}>{Object.entries(roles).map(([key,r])=><option value={key} key={key}>{r.label}</option>)}</select></label>
 <button disabled={busy} className="ui-btn" data-variant="primary" type="submit">Grant access</button></div>
 <p className={'role-description '+(role==='admin'?'admin-description':'')}>{roles[role].description}</p>
 </form><p className="access-message" role="status">{message}</p>
 {matchId&&<form className="ui-panel" style={{padding:20,marginBottom:20}} onSubmit={e=>{e.preventDefault();void assign()}}><h2>Assign scouting session</h2><p>Existing recorded points stay intact. Pending saves from the previous scouter will be blocked.</p><label>Active scouter <select required className="ui-input" value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Choose a person</option>{people.filter(g=>g.user_id&&g.status==='active'&&g.role!=='viewer').map(g=><option key={g.email} value={g.email}>{g.email}</option>)}</select></label> <button className="ui-btn" disabled={busy||!assignee}>Assign session</button></form>}<div className="ui-panel people-panel"><h2>People</h2>{admins.map(a=><div className="person-row" key={a.id}><div className="identity"><strong>{a.email}</strong><small>Protected account</small></div><span className="role-label">Administrator</span></div>)}
 {people.map(p=><div className="person-row" key={p.email}><div className="identity"><strong>{p.email}</strong><small>{p.status==='suspended'?'Suspended':p.user_id?'Active':'Awaiting verified sign-in'}</small></div>
 {editing===p.email?<div className="edit-role"><label className="sr-label" htmlFor="edit-access-level">Access level for {p.email}</label><select id="edit-access-level" className="ui-input" value={editRole} onChange={e=>setEditRole(e.target.value as Role)}>{Object.entries(roles).map(([key,r])=><option key={key} value={key}>{r.label}</option>)}</select><button disabled={busy} className="ui-btn" onClick={()=>{void update(p.email,p.status,editRole)}}>Save</button><button disabled={busy} className="ui-btn" data-variant="ghost" onClick={()=>setEditing(null)}>Cancel</button><small>{roles[editRole].description}</small></div>:<><span className="role-label">{roles[p.role].label}</span><button disabled={busy} className="ui-btn" onClick={()=>{setEditing(p.email);setEditRole(p.role)}}>Change level</button></>}
 <button disabled={busy} className="ui-btn" data-variant="ghost" onClick={()=>{void update(p.email,p.status==='suspended'?'active':'suspended',p.role)}}>{p.status==='suspended'?'Restore access':'Suspend'}</button></div>)}</div>

 </section>;
}
