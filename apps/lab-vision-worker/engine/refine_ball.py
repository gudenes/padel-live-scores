import json,math,subprocess
from pathlib import Path
import cv2,numpy as np
import argparse
ap=argparse.ArgumentParser();ap.add_argument('--config',required=True);C=json.loads(Path(ap.parse_args().config).read_text());P=Path(C['out'])
rows=json.loads((P/'wasb-all-candidates.json').read_text());N=len(rows)
# Conservative global scene-change guard. No court-boundary mask: legal out-of-court balls remain possible.
cap=cv2.VideoCapture(str(Path(C['root'])/C['source']));cuts=set();prev=None;cap.set(cv2.CAP_PROP_POS_MSEC,C['start']*1000)
for i in range(N):
 ok,f=cap.read()
 if not ok:raise RuntimeError('Short source')
 small=cv2.resize(f,(64,36)).astype(float)
 if prev is not None and np.mean(np.abs(small-prev))>45:cuts.add(i)
 prev=small
cap.release()
track_rows=sum([json.loads(f.read_text()) for f in sorted((P/'chunks').glob('*.json'))],[])
previous=None
for i,r in enumerate(rows):
 tr=track_rows[min(len(track_rows)-1,i)]
 sid=tr['segment_id']
 if sid is None or sid!=previous:cuts.add(i)
 if sid is None:r['candidates']=[];r['prediction']=None
 previous=sid
# Offline beam search: retain alternatives across time, with an explicit missing state.
# Costs are experimental image-space heuristics, not calibrated probabilities.
beam=[dict(cost=0,last=None,vel=None,frame=-1,node=None)];width=40
for i,r in enumerate(rows):
 if i in cuts:
  best=min(beam,key=lambda s:s['cost']);beam=[dict(cost=best['cost'],last=None,vel=None,frame=-1,node=best['node'])]
 options=[]
 for state in beam:
  options.append(dict(cost=state['cost']+1.7,last=state['last'],vel=state['vel'],frame=state['frame'],node=(state['node'],None)))
  for q in r['candidates']:
   point=np.array([q['x'],q['y']]);cost=-math.log(max(q['peak'],.01));vel=None;dt=i-state['frame']
   if state['last'] is not None and dt<=8:
    delta=point-state['last'];speed=float(np.linalg.norm(delta))/dt
    if speed>100:continue
    cost+=max(0,speed-40)/20
    vel=delta/dt
    if state['vel'] is not None:
     residual=float(np.linalg.norm(delta-state['vel']*dt))/max(1,dt)
     # Robust penalty permits real contacts and wall rebounds; large switches remain costly.
     cost+=min(residual/18,5)
   elif state['last'] is not None:cost+=2
   options.append(dict(cost=state['cost']+cost,last=point,vel=vel,frame=i,node=(state['node'],q)))
 # Keep distinct motion histories, otherwise many duplicate states crowd out alternatives.
 options.sort(key=lambda s:s['cost']);unique={}
 for s in options:
  key=(s['frame'],None if s['last'] is None else tuple(np.round(s['last']/4)),None if s['vel'] is None else tuple(np.round(s['vel']/5)))
  if key not in unique:unique[key]=s
  if len(unique)>=width:break
 beam=list(unique.values())
node=min(beam,key=lambda s:s['cost'])['node'];selected=[]
while node is not None:node,q=node;selected.append(q)
selected.reverse();assert len(selected)==N
out=[{'frame':i,'source_s':rows[i]['source_s'],'point':q,'kind':'detected' if q else 'missing'} for i,q in enumerate(selected)]
# Fill at most 5 frames (167ms), bounded by detections and compatible velocities on BOTH sides.
i=0
while i<N:
 if selected[i] is not None:i+=1;continue
 a=i
 while i<N and selected[i] is None:i+=1
 b=i;length=b-a
 if not (1<=length<=5 and a>=2 and b+1<N):continue
 if any(k in cuts for k in range(a-1,b+2)):continue
 if any(selected[k] is None for k in (a-2,a-1,b,b+1)):continue
 xy=lambda k:np.array([selected[k]['x'],selected[k]['y']])
 delta=xy(b)-xy(a-1);v=delta/(length+1)
 if np.linalg.norm(delta)>100 or np.linalg.norm(v-(xy(a-1)-xy(a-2)))>20 or np.linalg.norm(v-(xy(b+1)-xy(b)))>20:continue
 for k in range(a,b):
  pt=xy(a-1)+v*(k-a+1);out[k].update(point={'x':float(pt[0]),'y':float(pt[1])},kind='inferred')
(P/'wasb-refined-trajectory.json').write_text(json.dumps(out))
def stats(points):
 steps=[math.hypot(b['x']-a['x'],b['y']-a['y']) for a,b in zip(points,points[1:]) if a and b];return {'frames_with_position':sum(x is not None for x in points),'jumps_over_80px':sum(d>80 for d in steps),'consecutive_pairs':len(steps)}
summary={'raw':stats([r['prediction'] for r in rows]),'revised':stats([r['point'] for r in out]),'detected_frames':sum(r['kind']=='detected' for r in out),'inferred_frames':sum(r['kind']=='inferred' for r in out),'missing_frames':sum(r['kind']=='missing' for r in out),'cut_frames':sorted(cuts),'method':'Offline beam search, width 40; peak confidence + robust motion costs; explicit missing state. Up to five gap frames interpolated only with compatible endpoint velocities. All parameters experimental. Reduced jumps are expected by construction and do not prove accuracy.'}
(P/'refined-summary.json').write_text(json.dumps(summary,indent=2));print(summary,flush=True)