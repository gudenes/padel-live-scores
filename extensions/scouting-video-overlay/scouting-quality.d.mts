export interface ScoutingQuality {version:string;score:number|null;label:'Not rated'|'High'|'Medium'|'Low';review:string;provisional:boolean;components:{completeness:number;consistency:number;reconciliation:number};issues:string[];coverage:{scouted:number;scoreOnly:number;unknownGap:boolean};details:{previousStrokes:number;errors:number}}
export function scoutingQuality(input:{model:any;doc:any;checkpoint?:any;officialSets?:any[]}):ScoutingQuality;
export function qualityScoreKey(model:any):string;
export function qualityCheckpoint(model:any,at?:string):{version:1;key:string;at:string};
export function validateQualityCheckpoint(value:unknown):{version:1;key:string;at:string}|undefined;
