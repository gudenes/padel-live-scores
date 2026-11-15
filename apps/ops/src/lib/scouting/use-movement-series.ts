'use client';
import {useEffect,useState} from 'react';
import {createMovementLoader,movementCacheKey,type MovementData} from './movement-cache';
import {movementStore} from './movement-cache-storage';
import type {AnalysisResult} from './use-analysis-result';
const loadMovement=createMovementLoader(movementStore);
type State={key:string;data:MovementData['data']|null;motion?:MovementData['motion'];progress:number;error:string};
const empty:Omit<State,'key'>={data:null,progress:0,error:''};
export function useMovementSeries(result:AnalysisResult|null,enabled=true){
 const key=result?movementCacheKey(result):'';
 const [state,setState]=useState<State>({key:'',...empty});
 useEffect(()=>{
  if(!result||!enabled)return;
  let alive=true;setState({key,...empty});
  const request=loadMovement(result,progress=>{if(alive)setState({key,...empty,progress});});
  request.promise.then(value=>{if(alive)setState({key,...value,progress:100,error:''});},e=>{if(alive)setState({key,...empty,error:e instanceof Error?e.message:'Tracking unavailable'});});
  return()=>{alive=false;request.unsubscribe();};
 // The versioned key includes every source input; polling object identity is irrelevant.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,enabled]);
 return enabled&&key&&state.key===key?state:empty;
}
