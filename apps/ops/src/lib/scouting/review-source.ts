export type ReviewSourceChoice='auto'|'broadcast'|'uploaded'|'local';
export function selectReviewSource(choice:ReviewSourceChoice,available:{broadcast:boolean;uploaded:boolean;local:boolean}):Exclude<ReviewSourceChoice,'auto'>{
 if(choice!=='auto'&&available[choice])return choice;
 return available.uploaded?'uploaded':available.broadcast?'broadcast':available.local?'local':'broadcast';
}
export function reviewSourceOffset(source:Exclude<ReviewSourceChoice,'auto'>,localOffset:number,uploadedOffset:number,analysisOffset?:number){
 return source==='broadcast'?0:analysisOffset??(source==='uploaded'?uploadedOffset:localOffset);
}
