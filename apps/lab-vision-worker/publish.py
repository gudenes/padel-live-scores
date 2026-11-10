"""Package measured outputs for the authenticated web viewer; never re-run inference."""
import bisect,json,math
from activity import detect_activity
from pathlib import Path

def package(root,setup):
 root=Path(root);out=root/'viewer';out.mkdir(exist_ok=True)
 def read(p):return json.loads(p.read_text())
 def write(name,value):(out/name).write_text(json.dumps(value,separators=(',',':'),allow_nan=False))
 data=read(root/'data.json');rows=data['rows'];times=[r['source_s'] for r in rows]
 summary=read(root/'tracking-summary.json');w,h=summary['source_dimensions'];H=summary['homography']
 end=min(setup['duration'],setup['matchStart']+setup['analysisSeconds']);chunks={i:{'rows':[],'poses':[],'ball':[]} for i in range(math.ceil(end/60))};coverage=[]
 names=setup['playerNames'];ids=setup.get('playerIds') or [None]*4
 players=[{'key':f'p{i}','id':ids[i],'name':n,'team':i//2} for i,n in enumerate(names)];keys={p['name']:p['key'] for p in players}
 for r in rows:
  t=r['source_s'];valid=bool(r.get('overlay_visible') and r.get('segment_id') is not None and r['players']);i=int(t//60)
  if i not in chunks:continue
  ps={keys[n]:{'court_m':v['court_m'],'position_source':v.get('position_source','observed')} for n,v in r['players'].items() if n in keys} if valid else {}
  chunks[i]['rows'].append({'source_s':t,'segment_id':r.get('segment_id'),'overlay_visible':valid,'players':ps})
  if valid:
   if coverage and coverage[-1][2]==r['segment_id'] and t-coverage[-1][1]<.16:coverage[-1][1]=round(min(end,t+.1),4)
   else:coverage.append([t,round(min(end,t+.1),4),r['segment_id']])
 def at(t):
  if not rows:return None
  r=rows[max(0,bisect.bisect_right(times,t)-1)]
  return r if r.get('overlay_visible') and r.get('segment_id') is not None and abs(t-r['source_s'])<.15 else None
 for file in sorted(root.glob('block-*/pose-30fps/chunk-*.json')):
  for r in read(file):
   t=r['source_s'];tr=at(t);i=int(t//60)
   if not tr or i not in chunks:continue
   pairs=[];ds=r['detections']
   for n,v in tr['players'].items():
    if n not in keys or v.get('position_source')!='observed':continue
    for j,d in enumerate(ds):
     if d.get('pos'):pairs.append((math.dist(v.get('raw_court_m',v.get('unstabilized_court_m',v['court_m'])),d['pos']),n,j))
   chosen={};used=set()
   for cost,n,j in sorted(pairs):
    if cost>1.6 or keys[n] in chosen or j in used:continue
    alternatives=[c for c,nn,jj in pairs if nn==n and jj!=j]
    if alternatives and min(alternatives)-cost<.25:continue
    chosen[keys[n]]=[[round(v,3) for v in kp] for kp in ds[j]['kp']];used.add(j)
   if chosen:chunks[i]['poses'].append({'t':round(t,5),'players':chosen})
 for r in read(root/'wasb-refined-trajectory.json'):
  t=r['source_s'];p=r.get('point');i=int(t//60)
  if not p or not at(t) or i not in chunks:continue
  x,y=p['x']*w/1280,p['y']*h/720;q=[a*x+b*y+c for a,b,c in H]
  if abs(q[2])<1e-8:continue
  court=[q[0]/q[2],q[1]/q[2]]
  if all(math.isfinite(v) for v in court) and -1<=court[0]<=11 and -1<=court[1]<=21:chunks[i]['ball'].append({'t':t,'court':court,'kind':r.get('kind','detected')})
 performance={}
 for p in players:
  m=dict(data['metrics'][p['name']]);distance=seconds=0
  for a,b in zip(rows,rows[1:]):
   dt=b['source_s']-a['source_s']
   if not a.get('overlay_visible') or not b.get('overlay_visible') or a.get('segment_id') is None or a['segment_id']!=b.get('segment_id') or not 0<dt<=.15:continue
   if not all(r['players'].get(p['name'],{}).get('position_source')=='observed' for r in (a,b)):continue
   before=a.get('observed_distance_m',{}).get(p['name']);after=b.get('observed_distance_m',{}).get(p['name'])
   if before is None or after is None or after<before:continue
   distance+=after-before;seconds+=dt
  m.update(average_speed_kmh=round(distance/seconds*3.6,3) if seconds else None,average_coverage_s=round(seconds,3));performance[p['key']]=m
 manifest={'version':1,'start':setup['matchStart'],'end':end,'duration':setup['duration'],'chunkSeconds':60,'chunks':len(chunks),'coverage':coverage,'players':players,'inverseHomography':summary['inverse_homography'],'sourceDimensions':[w,h],'broadcastOffset':setup['offset'],'partial':end<setup['duration']-.1,'performance':performance,'identity':'Identity after camera cuts remains provisional','pose':'2D joints anchored to court positions, not measured 3D joint depth','ball':'Ground-plane projection; ball height is unknown','zoneSchema':data['zone_schema']}
 manifest['activity']=detect_activity([r for c in chunks.values() for r in c['rows']],[p for c in chunks.values() for p in c['poses']],read(root/'wasb-refined-trajectory.json'),coverage)
 for i,c in chunks.items():write(f'{i:03d}.json',c)
 write('manifest.json',manifest)
 return manifest

def publish(worker,setup):
 manifest=package(worker.folder,setup);assets=[]
 for f in sorted((worker.folder/'viewer').glob('*.json')):assets.append({'file':f.name,'size':f.stat().st_size})
 import requests
 for i,a in enumerate(assets):
  if worker.stopped.is_set():raise RuntimeError('Publication stopped')
  worker.stage('uploading',i,len(assets)+1)
  url=worker.api('viewer-upload',**a)['url']
  with (worker.folder/'viewer'/a['file']).open('rb') as f:
   r=requests.put(url,data=f,headers={'Content-Type':'application/json'},timeout=(10,180));r.raise_for_status()
 return {'version':1,'assets':assets}
