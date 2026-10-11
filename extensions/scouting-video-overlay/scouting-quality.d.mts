export interface ScoutingQuality {version:string;mode:string;modeInferred:boolean;sequences:{mode:string;inferred:boolean;expert:number;eligible:number;assessed:number;consistent:number;missing:number;transitions:number;invalidTransitions:number;percent:number|null;transitionPercent:number|null;flagged:{id:string;number:number;invalidTransitions:number}[]};score:number|null;label:'Not rated'|'High'|'Medium'|'Low';review:string;provisional:boolean;components:{completeness:number;consistency:number;recordConsistency:number;sequenceConsistency:number|null;reconciliation:number};issues:string[];coverage:{scouted:number;scoreOnly:number;unknownGap:boolean};details:{previousStrokes:number;errors:number}}
export function scoutingQuality(input:{model:any;doc:any;checkpoint?:any;officialSets?:any[];rallies?:any[]}):ScoutingQuality;
export function qualityScoreKey(model:any):string;
export function qualityCheckpoint(model:any,at?:string):{version:1;key:string;at:string};
export function validateQualityCheckpoint(value:unknown):{version:1;key:string;at:string}|undefined;

export function rallySequenceQuality(points:any[],rallies?:any[]):ScoutingQuality["sequences"];
