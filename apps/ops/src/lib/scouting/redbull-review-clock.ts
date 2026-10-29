/** Map review commands without modifying saved scouting timestamps. */
export function reviewOffset(recordedStart:number,videoTime:number){
 if(!Number.isFinite(recordedStart)||recordedStart<0||!Number.isFinite(videoTime)||videoTime<0)throw Error('Choose a point with a timestamp and position the video at its first serve.');
 return videoTime-recordedStart;
}
export function reviewTarget(recordedTime:number,offset:number|null,seekable:number[][]){
 if(offset===null)throw Error('Align a point with the video before jumping to recorded moments.');
 const target=recordedTime+offset;
 if(!Number.isFinite(target)||!seekable.some(([start,end])=>target>=start&&target<end))throw Error('This moment is outside the available Red Bull replay window. Check the alignment or open the full replay.');
 return target;
}
