export interface VideoState {
 version:1;
 label:string;
 setup:{names:string[];firstServer:number;otherServer:number;rule:string;near?:string;positions?:{a:boolean;b:boolean};adjustments?:unknown[]};
 rallies:unknown[];
 cancelled:unknown[];
 pending:unknown|null;
}
export function validateVideoState(raw:unknown):VideoState;
export function videoPayload(raw:unknown):VideoState;
export function videoSummary(payload:VideoState):{score:unknown;stats:unknown;points:number;server:number};
