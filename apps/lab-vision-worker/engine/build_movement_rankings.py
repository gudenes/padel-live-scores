"""Rebuild provisional interval rankings from saved stabilized 10 Hz movement."""
from pathlib import Path
import json,argparse
parser=argparse.ArgumentParser();parser.add_argument('--root',required=True);P=Path(parser.parse_args().root)
d=json.loads((P/'data.json').read_text());rows=d['rows'];names=d['names'];out=[]
for sid in sorted({r['segment_id'] for r in rows if r.get('segment_id')}):
 indices=[i for i,r in enumerate(rows) if r.get('segment_id')==sid]
 a,b=indices[0],indices[-1];start,end=rows[a]['source_s'],rows[b]['source_s'];duration=end-start
 if duration<=0: continue
 players={};peak=None
 for n in names:
  observed=inferred=known=0.;speeds=[]
  for i in indices[1:]:
   r,prev=rows[i],rows[i-1];dt=r['source_s']-prev['source_s']
   if prev.get('segment_id')!=sid or not 0<dt<=.2: continue
   observed+=max(0,r['observed_distance_m'][n]-prev['observed_distance_m'][n])
   inferred+=max(0,r['inferred_distance_m'][n]-prev['inferred_distance_m'][n])
   if r['players'].get(n,{}).get('position_source')=='observed' and prev['players'].get(n,{}).get('position_source')=='observed': known+=dt
   if i-a>=10:
    window=rows[i-10:i+1];span=r['source_s']-window[0]['source_s']
    if .99<=span<=1.01 and all(x.get('segment_id')==sid and x['players'].get(n,{}).get('position_source')=='observed' for x in window):
     speed=max(0,(r['observed_distance_m'][n]-window[0]['observed_distance_m'][n])*3.6/span)
     speeds.append(speed)
     if peak is None or speed>peak['kmh']: peak=dict(kmh=speed,player=n,source_s=r['source_s'])
  players[n]=dict(distance_m=round(observed+inferred,2),observed_m=round(observed,2),inferred_m=round(inferred,2),coverage_pct=round(100*known/duration,1),max_speed_kmh=round(max(speeds),2) if speeds else None)
 total=sum(x['distance_m'] for x in players.values());coverage=sum(x['coverage_pct'] for x in players.values())/len(names)
 out.append(dict(id=sid,start_s=start,end_s=end,duration_s=round(duration,1),distance_m=round(total,2),inferred_m=round(sum(x['inferred_m'] for x in players.values()),2),movement_rate_mps=round(total/duration,2),coverage_pct=round(coverage,1),max_speed_kmh=round(peak['kmh'],2) if peak else None,peak=peak,players=players,status='Unverified tracking interval; not a confirmed rally or game'))
result=dict(name='Lab Vision',scope='Full first match',method='Rank accepted tracking segments; cumulative stabilized distances differenced within each segment. Peak speed uses 1-second fully observed windows. Combined movement rate is all-player distance divided by interval duration; it is not a player speed or validated intensity score.',limits=['Point boundaries and game numbers unconfirmed','Intervals may contain dead time or replay footage','Identity after cuts needs review','Lower coverage can understate movement','Metrics remain on the existing 10 Hz baseline; 30 fps pose comparison is separate'],intervals=out)
(P/'movement-rankings.json').write_text(json.dumps(result,indent=2))
print('Built',len(out),'intervals')
for key in ['distance_m','max_speed_kmh','movement_rate_mps']:
 print(key,sorted(out,key=lambda r:r[key] if r[key] is not None else -1,reverse=True)[:10])
