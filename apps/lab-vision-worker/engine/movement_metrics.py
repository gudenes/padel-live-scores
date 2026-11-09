"""Derive movement metrics and gap-filled display rows without changing observed tracks."""
from pathlib import Path
import json, math, argparse

ZONE_SCHEMA = {'version': 'net-depth-5-7-v2', 'distance_from': 'net',
 'attack_m': [0, 5], 'transition_m': [5, 7], 'defence_m': [7, 10],
 'boundary_rule': 'Lower bound inclusive; upper bound exclusive, except court boundary at 10 m.'}

def derive(rows,names,hz=10):
 dt=1/hz
 stats={n:dict(distance_m=0.,max_speed_kmh=None,speed_coverage_s=0.,observed_s=0.,inferred_s=0.,unknown_s=0.,attack_s=0.,transition_s=0.,defence_s=0.,inferred_attack_s=0.,inferred_transition_s=0.,inferred_defence_s=0.) for n in names}
 history={n:[] for n in names};recent={};sid=None;display=[]
 for row in rows:
  r=dict(row);r['players']={n:dict(p,position_source='observed') for n,p in row['players'].items()};t=r['source_s']
  if r['segment_id']!=sid or r['segment_id'] is None:
   history={n:[] for n in names};recent={};sid=r['segment_id']
  for n in names:
   m=stats[n];p=row['players'].get(n);h=history[n]
   if p:
    xy=p['court_m'];m['observed_s']+=dt
    if h and t-h[-1][0]>.151:h.clear()
    h.append((t,xy));history[n]=h=[a for a in h if t-a[0]<=.6001]
    candidates=[a for a in h if .499<=t-a[0]<=.601]
    if candidates:
     old=min(candidates,key=lambda a:abs(t-a[0]-.5));speed=math.dist(old[1],xy)/(t-old[0])
     if speed<=9:
      m['max_speed_kmh']=max(m['max_speed_kmh'] or 0,speed*3.6);m['speed_coverage_s']+=dt
      r['players'][n]['speed_kmh']=speed*3.6
    recent[n]=(t,xy)
   else:
    history[n]=[]
    # Last-position hold is display/zone inference, never measured motion.
    if sid is not None and n in recent and t-recent[n][0]<=.6001:
     xy=recent[n][1];r['players'][n]={'court_m':xy,'position_source':'inferred_hold','gap_s':round(t-recent[n][0],3)};m['inferred_s']+=dt
    else:m['unknown_s']+=dt;continue
   depth=abs(xy[1]-10)
   if not (0<=xy[0]<=10 and 0<=xy[1]<=20):
    # Outside calibrated court does not contribute to zone occupancy.
    continue
   zone='attack' if depth<ZONE_SCHEMA['attack_m'][1] else 'transition' if depth<ZONE_SCHEMA['transition_m'][1] else 'defence'
   m[zone+'_s']+=dt
   if not p:m['inferred_'+zone+'_s']+=dt
   r['players'][n]['zone']=zone
   m['distance_m']=row['estimated_distance_m'].get(n,m['distance_m'])
  # Cumulative observed distance can increase even when no drawable position exists.
  for n in names:stats[n]['distance_m']=row['estimated_distance_m'].get(n,stats[n]['distance_m'])
  r['overlay_visible']=bool(r['players']);display.append(r)
 for m in stats.values():
  zone_total=sum(m[z+'_s'] for z in ['attack','transition','defence'])
  m['pressure_index']=100*(m['attack_s']+m['transition_s'])/zone_total if zone_total else None
  m['dominant_zone']=max(['attack','transition','defence'],key=lambda z:m[z+'_s']) if zone_total else None
  for k,v in m.items():
   if isinstance(v,float):m[k]=round(v,3)
 return stats,display

def main():
 parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();root=Path(args.run)
 summary=json.loads((root/'summary.json').read_text());rows=[]
 for path in sorted((root/'chunks').glob('*.json')):rows+=json.loads(path.read_text())
 metrics,display=derive(rows,list(summary['estimated_distance_m']))
 out=root/'display-chunks';out.mkdir(exist_ok=True)
 for i in range(0,len(display),600):(out/f'{i//600:03d}.json').write_text(json.dumps(display[i:i+600],separators=(',',':')))
 report={'zone_schema':ZONE_SCHEMA,'players':metrics,'window_s':[summary['source_start_s'],summary['source_end_s']],'scope':'Accepted main-camera footage, including between-point movement. Not yet aligned to scouting rally intervals.','method':{'distance':'Existing observed filtered 2 Hz path increments; no gap or cut bridges.','speed':'Maximum 0.5-second observed displacement speed; rejects >9 m/s; km/h.','inference':'Hold last observed position up to 0.6s in same camera segment; never contributes distance/speed.','zones':'Distance from net: attack/volley 0–5 m; transition 5–7 m; defence 7–10 m. Includes separately counted held positions.','pressure_index':'100 × (attack + transition) / known zone time.'},'identity_status':summary['identity_status'] if 'identity_status' in summary else 'Court-role identity proposals require review','court_windows':json.loads((root/'segments.json').read_text())}
 (root/'movement-summary.json').write_text(json.dumps(report,indent=2))
 print(json.dumps({'state':'complete','players':metrics}))
if __name__=='__main__':main()
