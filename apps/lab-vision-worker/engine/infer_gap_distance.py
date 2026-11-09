"""Add bounded straight-line gap estimates to stabilized observed distances."""
from pathlib import Path
import json,copy,math
ROOT=Path(__file__).resolve().parent

def bridge(rows,name,max_gap=1.5):
 anchors=[i for i,r in enumerate(rows) if r['players'].get(name,{}).get('position_source')=='observed']
 accepted=[];rejected=[]
 for ia,ib in zip(anchors,anchors[1:]):
  if ib-ia<=1:continue
  a,b=rows[ia],rows[ib];dt=b['source_s']-a['source_s'];pa=a['players'][name]['court_m'];pb=b['players'][name]['court_m'];dist=math.dist(pa,pb)
  reason=None
  if a['segment_id'] is None or any(r['segment_id']!=a['segment_id'] or r.get('excluded_reason') for r in rows[ia:ib+1]):reason='camera/view discontinuity'
  elif dt>max_gap+.0001:reason='gap exceeds 1.5 seconds'
  elif dist>4 or dist/dt>6:reason='implausible endpoint displacement'
  event={'from_s':a['source_s'],'to_s':b['source_s'],'distance_m':dist,'duration_s':dt,'from_index':ia,'to_index':ib}
  if reason:event['reason']=reason;rejected.append(event)
  else:accepted.append(event)
 return accepted,rejected

def main():
 backup=ROOT/'data-before-gap-distance.json'
 if not backup.exists():backup.write_bytes((ROOT/'data.json').read_bytes())
 data=json.loads(backup.read_text());rows=data['rows'];report={}
 for name in data['names']:
  accepted,rejected=bridge(rows,name)
  inferred_total=sum(a['distance_m'] for a in accepted)
  for i,row in enumerate(rows):
   extra=0.
   for e in accepted:
    ia,ib=e['from_index'],e['to_index']
    if i>=ib:extra+=e['distance_m']
    elif i>ia:
     f=(row['source_s']-e['from_s'])/e['duration_s'];extra+=f*e['distance_m']
     pa=rows[ia]['players'][name]['court_m'];pb=rows[ib]['players'][name]['court_m']
     # Display interpolation only. Existing zone occupancy and observed speed stay untouched.
     old=row['players'].get(name,{})
     row['players'][name]={**old,'court_m':[pa[k]*(1-f)+pb[k]*f for k in (0,1)],'position_source':'inferred_gap','gap_s':e['duration_s']}
     row['players'][name].pop('speed_kmh',None)
   row.setdefault('observed_distance_m',{})[name]=row['estimated_distance_m'][name]
   row.setdefault('inferred_distance_m',{})[name]=extra
   row['estimated_distance_m'][name]+=extra
  m=data['metrics'][name];m['observed_distance_m']=m['distance_m'];m['inferred_distance_m']=round(inferred_total,3);m['distance_m']=round(m['distance_m']+inferred_total,3)
  report[name]={'observed_m':m['observed_distance_m'],'inferred_m':m['inferred_distance_m'],'total_m':m['distance_m'],'accepted_gaps':accepted,'rejected_gaps':rejected}
 method='Total = stabilized observed distance + straight-line distance between reliable endpoints of gaps <=1.5s in one accepted camera segment, displacement <=4m and speed <=6m/s. No extrapolation of leading/trailing gaps. Inferred movement does not increase max speed; zone/Pressure Index metrics retain prior method. Straight-line gap estimates can miss turns.'
 data['gap_distance_method']=method
 (ROOT/'data.json').write_text(json.dumps(data,separators=(',',':')))
 (ROOT/'metrics.json').write_text(json.dumps({'players':data['metrics'],'alignment':data['alignment'],'method':data['method'],'stabilization':data['stabilization'],'gap_distance_method':method},indent=2))
 (ROOT/'gap-distance-review.json').write_text(json.dumps({'method':method,'players':report},indent=2))
 for n,r in report.items():print(n,r['observed_m'],'+',r['inferred_m'],'=',r['total_m'],'accepted',len(r['accepted_gaps']),'rejected',len(r['rejected_gaps']))
if __name__=='__main__':main()
