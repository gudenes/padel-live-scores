"""Export full-match movement for the reviewed World Cup match; no video inference."""
import json
from pathlib import Path
import argparse
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
d=json.loads((a.source/'data.json').read_text());metrics=json.loads((a.source/'metrics.json').read_text())
ids={'DI NENNO':'6b0803c4-f0d8-4b26-bcce-853f6089c72f','AUGSBURGER':'3f700d1f-eb2b-41fb-a057-dd738bcd13fe','GOÑI':'e0fba382-f40d-4aa6-aa0e-d95327756e3a','LEBRÓN':'cf41febb-189d-4861-9099-aa1b34757bee'}
players={}
for name,m in metrics['players'].items():
    distance=seconds=0.
    for prev,row in zip(d['rows'],d['rows'][1:]):
        dt=row['source_s']-prev['source_s']
        if not row.get('segment_id') or row['segment_id']!=prev.get('segment_id') or not 0<dt<=.201:continue
        if not all(r['players'].get(name,{}).get('position_source')=='observed' for r in (prev,row)):continue
        delta=row['observed_distance_m'][name]-prev['observed_distance_m'][name]
        if delta<0:continue
        distance+=delta;seconds+=dt
    players[ids[name]]={**m,'average_speed_kmh':round(distance/seconds*3.6,3) if seconds else None,'average_coverage_s':round(seconds,1)}
out={'matchId':'53969a2c-431f-4ccc-a0e0-fc4cc84bcdfa','scope':'Full match','duration_s':7480,'players':players,'method':'Average speed = stabilized observed distance / valid observed interval duration, including stationary intervals. Missing observations and camera cuts excluded. Peak speed uses one-second observed windows. Total distance includes bounded straight-line gap estimates.'}
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(out,indent=2));print({k:round(v['average_speed_kmh'],2) for k,v in players.items()})
