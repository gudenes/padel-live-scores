"""Adapter for the established 30 Hz tracker, stabilized movement and WASB.
Original inputs are preserved; all processing happens in a job-specific folder.
"""
import json,os,sys,subprocess,shutil,math
from pathlib import Path
import cv2,numpy as np
ENGINE=Path(__file__).parent/'engine'
sys.path.insert(0,str(ENGINE))
import tracker_core as tc
from stabilize import process
from movement_metrics import ZONE_SCHEMA

def save(path,value):
 path=Path(path);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value));tmp.replace(path)
def run(root,job,source,stage,execute,settings):
 root=Path(root);setup=job['setup'];start=setup['matchStart'];end=min(setup['duration'],start+setup['analysisSeconds'])
 # Normalize once: WASB assumes exactly 30 decoded frames per second.
 stage('normalizing',0,end-start);video=root/'source-cfr30.mp4'
 if not video.exists():
  temp=root/'source-cfr30.partial.mp4'
  execute(['ffmpeg','-nostdin','-y','-v','error','-i',str(source),'-t',str(max(end,setup['calibrationTime']+1)),'-map','0:v:0','-an','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30','-c:v','h264_videotoolbox','-b:v','8M',str(temp)])
  temp.replace(video)
 cap=cv2.VideoCapture(str(video));duration=cap.get(cv2.CAP_PROP_FRAME_COUNT)/30
 if end>duration+.2:raise RuntimeError('Uploaded duration exceeds decoded video duration')
 cap.set(cv2.CAP_PROP_POS_MSEC,setup['calibrationTime']*1000);ok,ref=cap.read();cap.release()
 if not ok:raise RuntimeError('Cannot read calibration frame')
 cv2.imwrite(str(root/'reference.jpg'),ref)
 height,width=ref.shape[:2]
 pts=[{'x':p['x']*width,'y':p['y']*height} for p in setup['points']]
 marks={'court':dict(zip(['tl','tr','br','bl'],pts[:4])),'net':{'base_l':pts[4],'base_r':pts[5]},'players':dict(zip(setup['identities'],pts[6:]))}
 save(root/'calibration.json',{'match':marks});court=tc.Court(marks['court'],ref.shape)
 stage('preparing',0,1)
 detector=tc.PoseDetector(court,weights=settings['pose_weights'],imgsz=1280,device='mps');dets,_=detector(ref)
 colors={};used=set()
 for name,p in marks['players'].items():
  target=np.array(court.to_court(p['x'],p['y']));options=[(np.linalg.norm(np.array(d['pos'])-target),i,d) for i,d in enumerate(dets) if i not in used]
  if not options:raise RuntimeError('Four players were not detected in the confirmed frame. Choose a clearer setup frame.')
  dist,i,d=min(options,key=lambda x:x[0]);used.add(i)
  if dist>2:raise RuntimeError('Player detection does not match the confirmed foot marker. Review setup.')
  kp=np.array(d['kp']);ids=[5,6,12,11]
  if min(kp[k,2] for k in ids)<.35:raise RuntimeError('A player torso is hidden in the setup frame. Choose a clearer frame.')
  mask=np.zeros(ref.shape[:2],np.uint8);cv2.fillPoly(mask,[np.int32(kp[ids,:2])],255)
  colors[name]=np.median(cv2.cvtColor(ref,cv2.COLOR_BGR2LAB)[mask>0],axis=0)
 # Team membership comes from the report, not detected left/right ordering.
 names=setup['playerNames'];dark=names[:2];light=names[2:]
 prototypes=[np.mean([colors[n] for n in light],axis=0),np.mean([colors[n] for n in dark],axis=0)]
 if np.linalg.norm(prototypes[0]-prototypes[1])<15:raise RuntimeError('Team kits are too similar for this tracker to assign identities reliably. Review required before processing.')
 # jersey score is distance-to-dark minus distance-to-light: dark sorts first.
 cfg={'match_id':job['id'],'source_file':str(video),'reference_frame':'reference.jpg','calibration_file':'calibration.json','calibration_key':'match','start_s':start,'end_s':end,'sample_hz':30,'players':names,'light_team':light,'dark_team':dark,'team_colors_lab':[p.tolist() for p in prototypes],'device':'mps','pose_weights':settings['pose_weights'],'alignment':{'broadcast_at_source_zero_s':setup['offset'],'scouting_verified':False},'scoreboard_reference_rect':None}
 save(root/'config.json',cfg)
 merged=[];segments=[];sid=0;ball=[]
 blocks=[]
 for i,st in enumerate(np.arange(start,end,600)):
  en=min(st+600,end);out=root/f'block-{i:03d}';out.mkdir(exist_ok=True);cf=root/f'block-{i:03d}.json';bc=out/'ball-config.json'
  save(cf,{**cfg,'start_s':float(st),'end_s':float(en),'output_dir':str(out)})
  save(bc,{'root':str(root),'out':str(out),'source':str(video),'start':float(st),'duration':float(en-st)})
  blocks.append((out,cf,bc,float(st),float(en)))
 for out,cf,bc,st,en in blocks:
  if not (out/'summary.json').exists():
   stage('players',st-start,end-start);execute([sys.executable,str(ENGINE/'track.py'),'--config',str(cf)],out/'progress.json',st-start,end-start)
  su=json.loads((out/'summary.json').read_text());mapping={}
  for seg in json.loads((out/'segments.json').read_text()):sid+=1;mapping[seg['id']]=sid;seg['id']=sid;seg['snapshot']=f'{out.name}/'+seg['snapshot'];segments.append(seg)
  raw=[]
  for f in sorted((out/'chunks').glob('*.json')):raw.extend(json.loads(f.read_text()))
  for r in raw[::3]:r['segment_id']=mapping.get(r['segment_id']);merged.append(r)
 stage('movement',0,1)
 for row in merged:
  for player in row['players'].values():player['position_source']='observed'
 metrics,rows,quality=process({'rows':merged,'names':names})
 data={'rows':rows,'names':names,'metrics':metrics,'alignment':cfg['alignment'],'zone_schema':ZONE_SCHEMA,'stabilization':'Existing stationary-lock filter; one-second observed peak speed; no camera-cut bridges','method':'Observed calibrated movement with separately labelled bounded gap estimates. Identity after cuts remains provisional.'}
 save(root/'data.json',data)
 import infer_gap_distance
 infer_gap_distance.ROOT=root;(root/'data-before-gap-distance.json').unlink(missing_ok=True);infer_gap_distance.main()
 execute([sys.executable,str(ENGINE/'build_movement_rankings.py'),'--root',str(root)])
 data=json.loads((root/'data.json').read_text());save(root/'metrics.json',data['metrics']);save(root/'segments.json',segments);save(root/'tracking-summary.json',su)
 for out,cf,bc,st,en in blocks:
  if not (out/'wasb-all-candidates.json').exists():
   stage('ball',st-start,end-start);execute([sys.executable,str(ENGINE/'run_ball.py'),'--config',str(bc)],out/'ball-progress.json',st-start,end-start)
  if not (out/'wasb-refined-trajectory.json').exists():
   stage('refinement',st-start,end-start);execute([sys.executable,str(ENGINE/'refine_ball.py'),'--config',str(bc)])
  ball.extend(json.loads((out/'wasb-refined-trajectory.json').read_text()))
 save(root/'wasb-refined-trajectory.json',ball)
 save(root/'manifest.json',{'pipeline':'lab-vision-mac-v1','job_id':job['id'],'setup':setup,'source_video_time_preserved':True,'source_window':[start,end],'fps':30,'ball_space':'image pixels at 1280x720; not measured 3D flight','limits':['Identity after camera cuts requires review','Same-angle replays are not reliably excluded without a scoreboard guard','Contact and shot classification are not included','Inferred distances are labelled separately and excluded from peak speed'],'zone_schema':ZONE_SCHEMA})
 return data['metrics']
