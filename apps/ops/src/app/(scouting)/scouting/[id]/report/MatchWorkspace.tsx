'use client'
import {useState,type ReactNode} from 'react'
import ScoutLive from './ScoutLive'
export default function MatchWorkspace({children,matchId,enabled,localTest,initialLive=false}:{children:ReactNode;matchId:string;enabled:boolean;localTest:boolean;initialLive?:boolean}){
 const [live,setLive]=useState(initialLive)
 if(!enabled)return children
 return <>{!live&&<nav aria-label="Match workspace" style={{display:'flex',gap:12,padding:'16px 24px'}}><button className="ui-btn" data-variant={!live?'primary':'secondary'} aria-pressed={!live} onClick={()=>setLive(false)}>Match insights</button><button className="ui-btn" data-variant={live?'primary':'secondary'} aria-pressed={live} onClick={()=>setLive(true)}>Scout live</button></nav>}<div hidden={live}>{children}</div>{live&&<ScoutLive localTest={localTest} matchId={matchId} onExit={()=>setLive(false)}/>}</>
}
