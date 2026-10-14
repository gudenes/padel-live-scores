"use client";
import {useMemo,useState} from 'react';
import type {ReportView} from '@/lib/scouting/report-view';
import {replayPoints} from '@/lib/scouting/video-review';
import ReplayMomentum from './ReplayMomentum';
import './video-review.css';
export default function OverviewMomentum({data,scope}:{data:ReportView;scope:string}){
 const points=useMemo(()=>replayPoints(data.scopes.all.points,data.scopes.all.taps),[data]);
 const [selected,setSelected]=useState<string|undefined>(points[0]?.id);
 const filtered=points.filter(p=>scope==='all'||String(p.before.sets.length)===scope);
 return <section className="video-review overview-momentum" aria-label="Match momentum"><ReplayMomentum overview points={points} players={data.players} sets={data.sets} filtered={filtered} selected={selected} onChoose={setSelected} playerFiltered={scope!=='all'}/></section>;
}
