"""Offline movement stabilization; saved raw data is never overwritten.
Conservative review settings, not externally calibrated accuracy claims.
"""
from pathlib import Path
import copy,json,sys,math
import numpy as np

from movement_metrics import derive
ROOT=Path(__file__).resolve().parent

def stabilize_run(times,positions):
 p=np.asarray(positions,float);count=len(p)
 # Centered robust filtering only within uninterrupted observations.
 median=np.array([np.median(p[max(0,i-2):min(count,i+3)],axis=0) for i in range(count)])
 smooth=np.array([np.mean(median[max(0,i-2):min(count,i+3)],axis=0) for i in range(count)])
 output=smooth.copy();locked=None
 for i in range(count):
  window=smooth[max(0,i-3):min(count,i+4)]
  center=np.median(window,axis=0)
  radius=max(np.linalg.norm(window-center,axis=1))
  if locked is not None:
   if np.linalg.norm(smooth[i]-locked)>.35:locked=None
  if locked is None and len(window)>=6 and radius<=.18:locked=center.copy()
  if locked is not None:output[i]=locked
 # Half-second integration; retain small displacements in anchor until 12cm
 # is exceeded, rather than deleting a slow walk at every sample.
 distances=np.zeros(count);speeds=[None]*count;anchor=0;total=0.
 for i in range(1,count):
  if times[i]-times[anchor]>=.499:
   delta=float(np.linalg.norm(output[i]-output[anchor]));dt=times[i]-times[anchor]
   if delta>.12:
    if delta/dt<=9:total+=delta
    anchor=i
  distances[i]=total
  if i>=10:
   dt=times[i]-times[i-10]
   if .99<=dt<=1.01:
    speed=float(np.linalg.norm(output[i]-output[i-10]))/dt*3.6
    if speed<=32.4:speeds[i]=speed
 return output,distances,speeds

def process(data):
 rows=copy.deepcopy(data['rows']);names=data['names'];quality={n:0 for n in names}
 for row in rows:
  row['players']={n:p for n,p in row['players'].items() if p.get('position_source')=='observed'}
  row['estimated_distance_m']={n:0. for n in names}
 speed_samples={n:{} for n in names}
 for name in names:
  runs=[];run=[]
  for i,r in enumerate(rows):
   p=r['players'].get(name)
   if not p or r['segment_id'] is None or (run and (r['segment_id']!=rows[run[-1]]['segment_id'] or r['source_s']-rows[run[-1]]['source_s']>.151)):
    if run:runs.append(run);run=[]
   if p and r['segment_id'] is not None:run.append(i)
  if run:runs.append(run)
  totals={};base=0.
  for run in runs:
   times=[rows[i]['source_s'] for i in run]
   points=[rows[i]['players'][name].get('raw_court_m',rows[i]['players'][name]['court_m']) for i in run]
   pos,dist,speed=stabilize_run(times,points)
   for j,i in enumerate(run):
    player=rows[i]['players'][name];player['unstabilized_court_m']=player['court_m'];player['court_m']=pos[j].tolist();player.pop('speed_kmh',None)
    totals[i]=base+float(dist[j]);speed_samples[name][i]=speed[j]
    if j and np.linalg.norm(pos[j]-pos[j-1])<1e-8:quality[name]+=1
   base+=float(dist[-1])
  total=0.
  for i,row in enumerate(rows):
   if i in totals:total=totals[i]
   row['estimated_distance_m'][name]=total
 metrics,display=derive(rows,names)
 # Replace old 0.5-second speed measure consistently with sustained 1s speed.
 for n in names:
  speeds=[v for v in speed_samples[n].values() if v is not None]
  metrics[n]['max_speed_kmh']=round(max(speeds),3) if speeds else None
  metrics[n]['speed_coverage_s']=round(len(speeds)*.1,3)
 for i,row in enumerate(display):
  for n,p in row['players'].items():
   p.pop('speed_kmh',None)
   v=speed_samples[n].get(i)
   if v is not None:p['speed_kmh']=v
 return metrics,display,quality

if __name__=='__main__':
 backup=ROOT/'data-before-stabilization.json'
 if not backup.exists():backup.write_bytes((ROOT/'data.json').read_bytes())
 data=json.loads(backup.read_text());old=copy.deepcopy(data['metrics']);metrics,rows,quality=process(data)
 method={'positions':'Raw court foot estimates: centered 0.5s median followed by 0.5s mean; no filtering across observation gaps or cuts.', 'stationary':'Lock when 0.7s window radius <=0.18m; release after displacement >0.35m.', 'distance':'Integrate every >=0.5s; retain small displacement until >0.12m; no missing-observation/camera-cut bridges.', 'speed':'Maximum sustained 1-second displacement speed on stabilized observed positions.', 'limits':'Review settings, not ground-truth calibrated. Sustained airborne-foot errors and identity errors may remain. Small genuine steps can be suppressed.'}
 data['metrics']=metrics;data['rows']=rows;data['stabilization']=method
 data['method']='Stabilized observed movement, brief held display positions excluded from distance/speed. Ball path remains schematic inference from touches.'
 (ROOT/'data.json').write_text(json.dumps(data,separators=(',',':')))
 (ROOT/'metrics.json').write_text(json.dumps({'players':metrics,'alignment':data['alignment'],'method':data['method'],'stabilization':method},indent=2))
 report={'method':method,'comparison':{n:{'before_m':old[n]['distance_m'],'after_m':metrics[n]['distance_m'],'before_max_kmh':old[n]['max_speed_kmh'],'after_max_kmh':metrics[n]['max_speed_kmh'],'stationary_samples':quality[n]} for n in data['names']}}
 (ROOT/'stabilization-review.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
