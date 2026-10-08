export const matchUuid:RegExp;
export interface ManualInput {players:{name:string;id:string|null}[];matchDate:string|null;tournamentLabel:string;videoUrl:string}
export function manualInput(input:unknown):ManualInput;
export function manualDescriptor(row:any):any;
