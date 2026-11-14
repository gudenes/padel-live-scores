'use client';
import {createContext,useContext,useState,type ReactNode} from 'react';
import {DEFAULT_PAIR_RULES,type PairRules} from '@/lib/scouting/pair-position-rules';
const Context=createContext({enabled:true,setEnabled:(_v:boolean)=>{},rules:DEFAULT_PAIR_RULES,setRules:(_v:PairRules)=>{}});
export function TrackingRulesProvider({children}:{children:ReactNode}){
 const [enabled,setEnabled]=useState(true),[rules,setRules]=useState(DEFAULT_PAIR_RULES);
 return <Context.Provider value={{enabled,setEnabled,rules,setRules}}>{children}</Context.Provider>;
}
export const useTrackingRules=()=>useContext(Context);
export function TrackingRuleControls(){
 const {enabled,setEnabled,rules,setRules}=useTrackingRules();
 return <div className="tracking-rule-controls"><label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Experimental connection colors</label><p>Geometry only · 0.6s average. Serves, lobs and recovery can trigger false flags. Team identity colors stay unchanged.</p>{(['depth','spacing'] as const).map(metric=><fieldset key={metric}><legend>{metric==='depth'?'Depth difference':'Pair spacing'} (m)</legend>{(['Warning','Red'] as const).map(level=>{const key=`${metric}${level}` as keyof PairRules;return <label key={key}>{level==='Warning'?'Yellow':'Red'}<input aria-label={`${metric} ${level.toLowerCase()} threshold`} type="number" step="0.5" min={level==='Red'?rules[`${metric}Warning`]+.5:.5} max={level==='Warning'?rules[`${metric}Red`]-.5:15} value={rules[key]} onChange={e=>{const value=Number(e.target.value);if(!e.target.value||!Number.isFinite(value)||value<.5||value>15)return;if(level==='Warning'&&value>=rules[`${metric}Red`]||level==='Red'&&value<=rules[`${metric}Warning`])return;setRules({...rules,[key]:value});}}/></label>;})}</fieldset>)}<small>Pairs closer than 1.5 m are yellow. Missing tracking, court-side ambiguity and outside-court recovery are grey. These are trial thresholds, not validated tactical rules.</small><button className="ui-btn" onClick={()=>setRules(DEFAULT_PAIR_RULES)}>Reset trial rules</button></div>;
}
