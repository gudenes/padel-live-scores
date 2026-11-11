import {it,expect} from 'vitest';
import {completeMatchExport} from '../complete-match-export';
import type {AnalysisResult} from '../use-analysis-result';
import type {ReportView} from '../report-view';

it('retains every movement metric, player identity, alignment and coverage alongside all report scopes',()=>{
 const result={id:'job',videoId:'video',updatedAt:'today',assetBase:'/assets/',manifest:{partial:true,start:15,end:75,duration:4600,coverage:[[15,75,0]],scoutingAlignment:{version:1,offsetSeconds:939,method:'Reviewed'},players:[{key:'p0',id:'player'}],performance:{p0:{distance_m:120,max_speed_kmh:22,average_speed_kmh:5,inferred_distance_m:12,average_coverage_s:40,zones:{attack:12},futureMetric:17}}}} as unknown as AnalysisResult;
 const report={players:[{id:'player'}],scopes:{all:{stats:[1]},'1':{stats:[2]},'2':{stats:[3]}}} as unknown as ReportView;
 const payload={document:{events:[1]},playerImpact:{score:7},playerEvolution:[1]};
 const out=JSON.parse(JSON.stringify(completeMatchExport(payload,report,{result,videoId:'video'})));
 expect(out).toMatchObject(payload);
 expect(out.playerPerformance.scopes).toEqual(report.scopes);
 expect(out.movementAnalysis.result).toEqual(result);
 expect(out.movementAnalysis.status).toBe('available');
});
it('distinguishes absent analysis from an incomplete response',()=>{
 expect(completeMatchExport({},null,{result:null,videoId:null}).movementAnalysis).toMatchObject({status:'unavailable',result:null});
 expect(()=>completeMatchExport({},null,{} as never)).toThrow('incomplete');
});
