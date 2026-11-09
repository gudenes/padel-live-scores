"""Package existing Lab Vision outputs; no inference or changes to source measurements."""
import json,math,bisect,argparse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();src=a.source;out=a.output;out.mkdir(parents=True,exist_ok=True)
def read(f):return json.loads((src/f).read_text())
def write(f,d): (out/f).write_text(json.dumps(d,separators=(',',':')))
summary=read('summary.json');rows=read('data.json')['rows'];times=[r['source_s'] for r in rows];duration=summary['source_end_s'];chunks={i:{'rows':[],'poses':[],'ball':[]} for i in range(math.ceil(duration/60))}
intervals=[]
for r in rows:
 valid=bool(r.get('overlay_visible') and r.get('segment_id') is not None and r['players'])
 players={n:{'court_m':v['court_m'],'position_source':v.get('position_source','observed')} for n,v in r['players'].items()} if valid else {}
 chunks[int(r['source_s']//60)]['rows'].append({'source_s':r['source_s'],'segment_id':r.get('segment_id'),'overlay_visible':valid,'players':players})
 if valid:
  if intervals and intervals[-1][2]==r['segment_id'] and r['source_s']-intervals[-1][1]<.16:intervals[-1][1]=round(r['source_s']+.1,3)
  else:intervals.append([r['source_s'],round(r['source_s']+.1,3),r['segment_id']])
for file in sorted((src/'pose-30fps').glob('chunk-*.json')):
 for r in json.loads(file.read_text()):
  t=r['source_s'];i=int(t//60)
  if i not in chunks:continue
  k=min(len(rows)-1,max(0,bisect.bisect_right(times,t)-1));tr=rows[k]
  if not tr.get('overlay_visible') or abs(t-tr['source_s'])>.15:continue
  pairs=[];ds=r['detections']
  for n,v in tr['players'].items():
   target=v.get('raw_court_m',v['court_m'])
   for j,det in enumerate(ds):
    if det.get('pos'):pairs.append((math.dist(target,det['pos']),n,j))
  chosen={};used=set()
  for cost,n,j in sorted(pairs):
   if cost>1.6 or n in chosen or j in used:continue
   alternatives=[c for c,nn,jj in pairs if nn==n and jj!=j]
   if alternatives and min(alternatives)-cost<.25:continue
   chosen[n]=[[round(v,3) for v in kp] for kp in ds[j]['kp']];used.add(j)
  if chosen:chunks[i]['poses'].append({'t':round(t,5),'players':chosen})
gaps=read('court-ball-gaps.json')['frames'];continuity=read('court-ball-continuity.json')['frames'];H=summary['homography']
for r in read('wasb-refined-trajectory.json'):
 t=r['source_s'];i=int(t//60)
 if i not in chunks:continue
 tr=rows[min(len(rows)-1,max(0,bisect.bisect_right(times,t)-1))]
 if not tr.get('overlay_visible'):continue
 k=str(r['frame']);v=r if r.get('point') else gaps.get(k,r);point=v.get('point');court=None;kind=v.get('kind','missing')
 if point:
  x,y=point['x']*1.5,point['y']*1.5;q=[h[0]*x+h[1]*y+h[2] for h in H]
  if abs(q[2])>1e-8:
   c=[q[0]/q[2],q[1]/q[2]]
   if -1<=c[0]<=11 and -1<=c[1]<=21:court=c
 if court is None and k in continuity:court=continuity[k]['court_m'];kind='inferred'
 if court:chunks[i]['ball'].append({'t':t,'court':court,'kind':kind})
for i,c in chunks.items():write(f'{i:03}.json',c)
manifest={'start':0,'end':duration,'chunkSeconds':60,'chunks':len(chunks),'coverage':intervals,'inverseHomography':summary['inverse_homography'],'identity':'Court-role proposals after cuts; individual identities require review','pose':'2D joints anchored to court positions; not reconstructed joint depth','ball':'WASB floor projection; inferred gaps explicitly marked; not measured 3D flight','broadcastOffset':18881}
write('manifest.json',manifest);print(json.dumps({'chunks':len(chunks),'covered_seconds':sum(b-a for a,b,_ in intervals),'intervals':len(intervals),'poses':sum(len(c['poses']) for c in chunks.values()),'ball_frames':sum(len(c['ball']) for c in chunks.values())}))
