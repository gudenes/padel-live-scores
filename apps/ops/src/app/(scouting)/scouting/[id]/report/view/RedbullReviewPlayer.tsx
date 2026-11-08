'use client';
import {redbullEmbedUrl} from '@/lib/scouting/redbull-embed';

export default function RedbullReviewPlayer({url,command}:{url:string;command:{time:number;serial:number}}){
 const embed=redbullEmbedUrl(url,command.time);
 if(!embed)return <p role="alert">This Red Bull TV link could not be opened.</p>;
 return <div className="vr-redbull-review">
  <iframe key={command.serial} className="vr-player" src={embed} title="Red Bull TV match video" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen/>
  <div className="vr-redbull-help"><p>Select a point to jump to its recorded time, with a three-second lead-in. Red Bull reloads briefly for each jump. Rally loops, live time tracking and saving the current moment are unavailable.</p><a className="ui-btn" href={url} target="_blank" rel="noreferrer">Open on Red Bull TV</a></div>
 </div>;
}
