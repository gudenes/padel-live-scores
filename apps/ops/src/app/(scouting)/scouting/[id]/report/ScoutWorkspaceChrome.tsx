'use client'
import styles from './scout-live.module.css'
export type WorkspaceControl={key:string;label:string;text:string;shortcut:string;disabled:boolean;variant?:string;pressed?:string|null;expanded?:string|null}
export type WorkspaceUI={matchInfo?:{tournament?:string|null;round?:string|null;category?:string|null;court?:string|null};coachOverlay?:boolean;commands:WorkspaceControl[];rows:{text:string;serving:string;buttons:WorkspaceControl[]}[][];identity:string;pressure:string;media:WorkspaceControl[];speed:{value:string;disabled:boolean;options:{value:string;label:string}[]}|null}
type Action=(key:string,value?:string)=>void
export function ScoutScoreboard({ui,action}:{ui:WorkspaceUI|null;action:Action}){
 if(!ui?.rows.length)return null
 return <section className={styles.headerScore} aria-label="Scouting scoreboard"><table><thead><tr>{ui.rows[0].map((cell,i)=><th key={i} scope="col">{cell.text}</th>)}</tr></thead><tbody>{ui.rows.slice(1).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}><span>{cell.serving?cell.text.split(cell.serving).map((part,index)=><span key={index}>{index>0&&<strong title="Serving">{cell.serving}</strong>}{part}</span>):cell.text}</span>{cell.buttons.map(button=><button key={button.key} type="button" className="ui-btn" data-variant={button.variant==='record'?'record':'secondary'} title={button.label} aria-label={button.label} disabled={button.disabled} onClick={()=>action(button.key)}>{j===0?(button.variant==='record'?'Confirm coach':'Coach'):button.text}</button>)}</td>)}</tr>)}</tbody></table>{ui.pressure&&<small>{ui.pressure}</small>}</section>
}
export function ScoutPlayback({ui,action}:{ui:WorkspaceUI|null;action:Action}){
 if(!ui)return null
 const button=(control:WorkspaceControl)=><button key={control.key} type="button" className="ui-btn" data-variant="secondary" disabled={control.disabled} title={control.label} aria-label={control.label} onClick={()=>action(control.key)}><span>{control.text}</span>{control.shortcut&&<kbd>{control.shortcut}</kbd>}</button>
 return <div className={styles.playback} role="toolbar" aria-label="Video playback controls">{ui.media.slice(0,4).map(button)}{ui.speed&&<select className="ui-input" aria-label="Playback speed" value={ui.speed.value} disabled={ui.speed.disabled} onChange={event=>action('video-speed',event.target.value)}>{ui.speed.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>}<details className={styles.morePlayback}><summary className="ui-btn" title="More video controls">More</summary><div>{ui.media.slice(4).map(button)}</div></details></div>
}

export function ScoutHeaderCommands({ui,action}:{ui:WorkspaceUI|null;action:Action}){
 if(!ui)return null
 const labels:Record<string,string>={'scouting-menu-button':'Menu','scouting-log':'Scouting log','mode-pro':'Pro','mode-expert':'Expert','header-account':'Account'}
 return <div className={styles.scoutCommands} role="group" aria-label="Scouting commands">{(ui.commands??[]).map(control=><button key={control.key} type="button" className="ui-btn" data-variant={control.pressed==='true'?'primary':'secondary'} aria-label={control.label} title={control.label} aria-pressed={control.pressed===null?undefined:control.pressed==='true'} aria-expanded={control.expanded===null?undefined:control.expanded==='true'} disabled={control.disabled} onClick={()=>action(control.key)}>{control.key==='scouting-menu-button'&&<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>}{labels[control.key]??control.text}</button>)}</div>
}
