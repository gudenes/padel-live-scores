"""Import completed, comparable 30 fps/MPS pose + WASB block timings.
Pass directories containing block directories, not short smoke-test folders.
Only associate a worker ID after confirming these runs used the same computer.
"""
import argparse,json,statistics
from pathlib import Path
from datetime import date
p=argparse.ArgumentParser();p.add_argument('--worker-id',required=True);p.add_argument('--output',required=True);p.add_argument('matches',nargs='+');a=p.parse_args()
players=[];balls=[];matches=0
for root in dict.fromkeys(str(Path(x).resolve()) for x in a.matches):
 count=0
 for f in sorted(Path(root).glob('*/progress.json')):
  b=f.parent/'wasb-candidates-summary.json'
  if not b.exists():continue
  pose=json.loads(f.read_text());ball=json.loads(b.read_text());seconds=pose.get('processed_s',0);ball_seconds=ball.get('frames',0)/30
  if pose.get('state')!='complete' or seconds<60 or abs(seconds-ball_seconds)>.2:continue
  elapsed=pose.get('elapsed_s',0);wall=ball.get('wall_seconds_including_render',0)
  if elapsed<=0 or wall<=0:continue
  players.append(elapsed/seconds);balls.append(wall/ball_seconds);count+=1
 if count:matches+=1
if not players:raise SystemExit('No comparable completed blocks found')
def rates(values):return dict(median=statistics.median(values),low=min(values),high=max(values))
result=dict(version=1,pipeline='lab-vision-mac-v1',workerIds=[a.worker_id],matchCount=matches,blockCount=len(players),recordedAt=str(date.today()),description='Completed 30 fps pose + WASB blocks on this Mac. Short smoke tests excluded.',players=rates(players),ball=rates(balls))
Path(a.output).write_text(json.dumps(result,indent=2)+'\n');print(f'Imported {len(players)} blocks from {matches} matches')
