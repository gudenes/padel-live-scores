"""Pose/movement/WASB activity estimates in source-video seconds; not confirmed rallies."""
import bisect,math

def detect_activity(rows,poses,ball,coverage):
 rows=sorted(rows,key=lambda r:r["source_s"]);poses=sorted(poses,key=lambda p:p["t"]);ball=sorted(ball,key=lambda b:b["source_s"])
 if not rows:return {"method":"pose-movement-wasb-v1","windows":[],"duration":0}
 rt=[r['source_s'] for r in rows];pt=[r['t'] for r in poses]
 bt=[r['source_s'] for r in ball]
 def torso(k):
  if any(k[i][2]<.5 for i in [5,6,11,12]):return None
  sx,sy=[(k[5][j]+k[6][j])/2 for j in [0,1]];hx,hy=[(k[11][j]+k[12][j])/2 for j in [0,1]]
  scale=math.hypot(sx-hx,sy-hy)
  if scale<12:return None
  return [( (k[i][0]-sx)/scale,(k[i][1]-sy)/scale) if k[i][2]>=.6 else None for i in [9,10]]
 windows=[];diagnostics=[]
 for start,end,seg in coverage:
  bins=[];t=start
  while t<end:
   r=rows[min(len(rows)-1,bisect.bisect_left(rt,t))];old=rows[max(0,bisect.bisect_right(rt,t-.5)-1)]
   speeds=[]
   if r['segment_id']==seg and old['segment_id']==seg and start<=old['source_s']<=t and abs(r['source_s']-t)<=.15:
    for name,v in r['players'].items():
     u=old['players'].get(name)
     if u and v.get('position_source')=='observed' and u.get('position_source')=='observed':
      speed=math.dist(v['court_m'],u['court_m'])/max(.1,r['source_s']-old['source_s'])
      if speed<10:speeds.append(speed)
   wrist=0
   pi=bisect.bisect_left(pt,t);pj=bisect.bisect_right(pt,t-.2)-1
   if pi<len(poses) and pj>=0 and abs(poses[pi]['t']-t)<.1 and t-poses[pj]['t']<.3 and poses[pj]['t']>=start and poses[pi]['t']<end and poses[pi]['t']>poses[pj]['t']:
    for name,k in poses[pi]['players'].items():
     k0=poses[pj]['players'].get(name);u=torso(k);v=torso(k0) if k0 else None
     if u and v:
      wrist=max([wrist]+[math.dist(x,y)/(poses[pi]['t']-poses[pj]['t']) for x,y in zip(u,v) if x and y])
   samples=ball[bisect.bisect_left(bt,t):bisect.bisect_left(bt,min(end,t+.5))]
   detected=[b for b in samples if b['kind']=='detected' and b['point']]
   ball_motion=len(detected)>=3 and math.hypot(detected[-1]['point']['x']-detected[0]['point']['x'],detected[-1]['point']['y']-detected[0]['point']['y'])>8
   fast=sum(s>1.1 for s in speeds)>=2
   active=r['segment_id']==seg and abs(r['source_s']-t)<=.15 and len(r['players'])>=3 and ((ball_motion and (sum(speeds)>.9 or wrist>1.5)) or (fast and wrist>2.5))
   bins.append({'t':round(t,2),'active':active,'ball':ball_motion,'wrist':round(wrist,2),'moving':fast});t+=.5
  active=[b['t'] for b in bins if b['active']];groups=[]
  for t in active:
   if groups and t-groups[-1][-1]<=4:groups[-1].append(t)
   else:groups.append([t])
  for g in groups:
   if len(g)<3 or g[-1]-g[0]<1:continue
   lo=max(start,g[0]-2);hi=min(end,g[-1]+3)
   # Merge overlapping buffers only inside the same camera segment.
   if windows and windows[-1]['segment']==seg and lo<=windows[-1]['end']:windows[-1]['end']=round(hi,2)
   else:windows.append({'start':round(lo,2),'end':round(hi,2),'segment':seg})
  diagnostics.append({'segment':seg,'bins':bins})
 result={'method':'Pose + movement + detected WASB ball activity; experimental, not confirmed rallies','windows':windows,'duration':round(sum(w['end']-w['start'] for w in windows),2),'limits':['No scouting timestamps used','Serve and point-end contacts are not classified','Stationary rallies may be missed; walks and replays may remain','No intervals bridge camera segments','2-second lead-in and 3-second finish buffer, capped at tracking coverage'],'parameters':{'bin_seconds':.5,'activity_gap_seconds':4,'min_active_bins':3,'wrist_torso_lengths_per_second':2.5,'two_player_speed_mps':1.1}}
 result["version"]=1
 result["timebase"]="source-video-seconds"
 return result
