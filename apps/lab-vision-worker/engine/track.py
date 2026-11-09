from pathlib import Path
import os,sys,json,time,math,traceback,argparse
import cv2,numpy as np

import tracker_core as tc
parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--seconds',type=float);args=parser.parse_args()
CONFIG=Path(args.config).resolve();C=json.loads(CONFIG.read_text());ROOT=CONFIG.parent;OUT=ROOT/C['output_dir'];OUT.mkdir(exist_ok=True)
(OUT/'chunks').mkdir(exist_ok=True);(OUT/'segments').mkdir(exist_ok=True)
START,END,HZ=float(C['start_s']),float(C['end_s']),C.get('sample_hz',10)
if args.seconds:END=min(END,START+args.seconds)
NAMES=C['players'];LIGHT=C['light_team'];DARK=C['dark_team']
os.environ['POSE_IMGSZ']='1280';os.environ['CUT_ANCHOR']='0'
M=json.loads((ROOT/C['calibration_file']).read_text())[C['calibration_key']];ref=cv2.imread(str(ROOT/C['reference_frame']));court=tc.Court(M['court'],ref.shape);bg=tc.grey_small(ref)
seed={n:court.to_court(p['x'],p['y']) for n,p in M['players'].items()};roles={n:(seed[n][0] if seed[n][1]>10 else 10-seed[n][0]) for n in NAMES}
score_ref=None
if C.get('scoreboard_reference_rect'):
 x,y,w,h=C['scoreboard_reference_rect'];score_ref=cv2.cvtColor(ref,cv2.COLOR_BGR2GRAY)[y:y+h,x:x+w]
COLORS=dict(zip(NAMES,[(35,163,255),(45,239,197),(255,200,56),(252,244,237)]))
def save(name,data):
 p=OUT/name;t=p.with_suffix(p.suffix+'.tmp');t.write_text(json.dumps(data,separators=(',',':')));os.replace(t,p)
counts={k:0 for k in ['main_camera','camera_or_replay','initialization_or_team_uncertain','partner_overlap','detection_missing']};totals={n:0. for n in NAMES};seen={n:0 for n in NAMES};anchors={};last={};tracker=None;segment=None;segments=[];near_team=None;chunk=[];chunk_id=0;processed=0;stable=0;started=time.perf_counter();frame_s=START
save('progress.json',{'state':'starting','source_start_s':START,'source_end_s':END,'processed_s':0,'total_s':END-START,'estimated_distance_m':totals})
def progress(state,error=None):
 elapsed=time.perf_counter()-started;video_s=processed/HZ
 save('progress.json',{'state':state,'source_start_s':START,'source_end_s':END,'current_source_s':frame_s,'processed_s':video_s,'total_s':END-START,'elapsed_s':elapsed,'video_seconds_per_wall_second':video_s/max(elapsed,.001),'estimated_distance_m':totals,'sample_counts':counts,'detected_samples':seen,'segments':len(segments)+(1 if segment else 0),'identity_status':'All court-role seeded intervals require review; totals provisional','error':error})
def close_segment():
 global segment,tracker,near_team
 if segment:
  segment['end_source_s']=frame_s;segments.append(segment);save('segments.json',segments)
 segment=None;tracker=None;near_team=None;anchors.clear();last.clear()
def jersey(frame,d):
 kp=np.array(d['kp']);ids=[5,6,12,11]
 if min(kp[k,2] for k in ids)<.35:return None
 polygon=np.int32(kp[ids,:2]);x,y,w,h=cv2.boundingRect(polygon);x=max(0,x);y=max(0,y);w=min(w,frame.shape[1]-x);h=min(h,frame.shape[0]-y)
 if min(w,h)<4:return None
 mask=np.zeros((h,w),np.uint8);cv2.fillPoly(mask,[polygon-[x,y]],255)
 pixels=cv2.cvtColor(frame[y:y+h,x:x+w],cv2.COLOR_BGR2LAB)[mask>0]
 if len(pixels)<20:return None
 color=np.median(pixels,axis=0)
 prototypes=np.array(C['team_colors_lab'])
 distances=np.linalg.norm(prototypes-color,axis=1)
 return float(distances[1]-distances[0])

def layout(frame,dets):
 if len(dets)!=4:return None
 bright=[jersey(frame,d) for d in dets]
 if any(v is None for v in bright):return None
 order=sorted(range(4),key=lambda i:bright[i])
 if bright[order[1]]>-5 or bright[order[2]]<5:return None
 sides={i:dets[i]['pos'][1]>10 for i in range(4)}
 if sides[order[0]]!=sides[order[1]] or sides[order[2]]!=sides[order[3]] or sides[order[0]]==sides[order[2]]:return None
 mapping={}
 for ids,names in [(order[:2],DARK),(order[2:],LIGHT)]:
  ids=sorted(ids,key=lambda i:dets[i]['pos'][0] if sides[i] else 10-dets[i]['pos'][0])
  if abs(dets[ids[0]]['pos'][0]-dets[ids[1]]['pos'][0])<1.2:return None
  for name,idx in zip(sorted(names,key=lambda n:roles[n]),ids):mapping[name]=idx
 return mapping,('light' if sides[order[2]] else 'dark'),bright
try:
 detector=tc.PoseDetector(court,weights=C.get('pose_weights'),imgsz=1280,device=C.get('device','mps'));detector(ref)
 cap=cv2.VideoCapture(str(ROOT/C['source_file']));fps=cap.get(cv2.CAP_PROP_FPS)
 if not (10<=fps<=120):raise RuntimeError(f'Unsupported source frame rate {fps}; normalize recording to constant 30 fps first')
 cap.set(cv2.CAP_PROP_POS_MSEC,START*1000)
 pose_batch=[];pose_id=0;(OUT/'pose-30fps').mkdir(exist_ok=True);steps=round((END-START)*fps)
 for i in range(steps):
  if not cap.grab():raise RuntimeError('Source ended before selected match end')
  if i%round(fps/HZ):continue
  ok,frame=cap.retrieve()
  if not ok:raise RuntimeError('Could not decode source frame')
  if C.get('normalize_to_reference'):
   rh,rw=ref.shape[:2];fh,fw=frame.shape[:2];scale=min(rw/fw,rh/fh)
   nw,nh=round(fw*scale),round(fh*scale);resized=cv2.resize(frame,(nw,nh))
   frame=np.zeros_like(ref);left,top=(rw-nw)//2,(rh-nh)//2;frame[top:top+nh,left:left+nw]=resized
  elif frame.shape[:2]!=ref.shape[:2]:raise RuntimeError('Source and calibration dimensions differ; enable normalize_to_reference')
  frame_s=START+i/fps;camera=tc.is_main_camera(frame,bg)
  grey=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
  score=1.
  if score_ref is not None:
   sx,sy,sw,sh=C['scoreboard_search_rect'];score=float(cv2.matchTemplate(grey[sy:sy+sh,sx:sx+sw],score_ref,cv2.TM_CCOEFF_NORMED).max())
  allowed=camera and (score>=C.get('scoreboard_threshold',.65) or frame_s<START+10)
  matched={};reason=None;dets=[]
  if not allowed:
   counts['camera_or_replay']+=1;stable=0;close_segment();reason='camera view or scoreboard replay guard'
  else:
   counts['main_camera']+=1;stable+=1;dets,_=detector(frame);dets=dets[:4]
   pass
   arranged=layout(frame,dets)
   if tracker is not None and arranged and arranged[1]!=near_team:close_segment();stable=0
   if tracker is None and arranged and stable>=3:
    mapping,near_team,brightness=arranged;current_seed={n:dets[k]['pos'] for n,k in mapping.items()}
    tracker=tc.Tracker(court,current_seed,pairs=[LIGHT,DARK]);sid=len(segments)+1
    segment={'id':sid,'start_source_s':frame_s,'near_team':near_team,'initial_positions_m':current_seed,'identity_basis':'Confirmed-frame kit colour for team; user-seeded court-side role for individual; unvalidated','identity_review_required':True,'estimated_distance_m':{n:0. for n in NAMES},'partner_overlap_samples':0,'snapshot':f'segments/{sid:04d}.jpg'}
    review=frame.copy()
    for n,k in mapping.items():
     x,y=court.to_pixel(*dets[k]['pos']);cv2.putText(review,n+'?',(int(x)-50,int(y)+25),cv2.FONT_HERSHEY_SIMPLEX,.6,COLORS[n],2,cv2.LINE_AA)
    cv2.imwrite(str(OUT/segment['snapshot']),cv2.resize(review,(1280,720)))
   if tracker is None:
    counts['initialization_or_team_uncertain']+=1;reason='awaiting clear four-player team/layout initialization'
   else:
    result=tracker.step(frame_s*1000,dets,1/HZ)
    raw={n:np.array(dets[k]['pos']) for n,k in result['match'].items()}
    ambiguous=set()
    for pair in [LIGHT,DARK]:
     if all(n in raw for n in pair) and np.linalg.norm(raw[pair[0]]-raw[pair[1]])<.75:ambiguous.update(pair)
    if ambiguous:counts['partner_overlap']+=1;segment['partner_overlap_samples']+=1
    for n in NAMES:
     if n not in result['match'] or n in ambiguous:
      anchors.pop(n,None);last.pop(n,None)
      if n not in result['match']:counts['detection_missing']+=1
      continue
     d=dets[result['match'][n]];pos=np.array(tracker.tracks[n]['kf'].pos);seen[n]+=1
     if n not in last or frame_s-last[n]>.151:anchors.pop(n,None)
     if n not in anchors:anchors[n]=(frame_s,pos)
     elif frame_s-anchors[n][0]>=.499:
      old_t,old_pos=anchors[n];delta=float(np.linalg.norm(pos-old_pos))
      if delta/(frame_s-old_t)<=9:totals[n]+=delta;segment['estimated_distance_m'][n]+=delta
      anchors[n]=(frame_s,pos)
     last[n]=frame_s
     matched[n]={'court_m':pos.tolist(),'raw_court_m':raw[n].tolist(),'identity':'court-role proposal; review required'}
  pose_batch.append({'source_s':round(frame_s,6),'detections':dets})
  if len(pose_batch)==300:
   save(f'pose-30fps/chunk-{pose_id:03d}.json',pose_batch);pose_batch=[];pose_id+=1
  row={'source_s':round(frame_s,3),'overlay_visible':bool(matched),'segment_id':segment['id'] if segment else None,'players':matched,'estimated_distance_m':dict(totals),'excluded_reason':reason}
  chunk.append(row);processed+=1
  if len(chunk)==600:save(f'chunks/{chunk_id:03d}.json',chunk);chunk=[];chunk_id+=1
  if processed%30==0:
   progress('running')
   if segment:save('current-segment.json',segment)
  if processed%300==0:
   cv2.imwrite(str(OUT/'latest.jpg'),cv2.resize(frame,(1280,720)));save('segments.json',segments+([segment] if segment else []))
 close_segment()
 if chunk:save(f'chunks/{chunk_id:03d}.json',chunk)
 if pose_batch:save(f'pose-30fps/chunk-{pose_id:03d}.json',pose_batch)
 cap.release();progress('finalizing')
 summary={'state':'complete','source_start_s':START,'source_end_s':END,'match_window_s':END-START,'samples':processed,'estimated_distance_m':totals,'sample_counts':counts,'detected_samples':seen,'segments':len(segments),'method':'30 Hz pose and calibrated foot tracking; movement subsequently resampled to 10 Hz; filtered paths integrated at 2 Hz, speed <=9 m/s. No missing-observation, overlap or cut bridges. Per-view reinitialization, team kit hue and court-side role identity proposals.','limits':['Provisional observed distances, not validated total physical distance','Camera cuts, alternative views, excluded views and uninitialized/overlapping players excluded','Same-angle replays with a retained scoreboard may remain unrecognized','Names inferred by court role after cuts; segment identity review required; same-angle replay rejection unavailable without a configured scoreboard guard','Foot jitter, airborne ankles and calibration errors can overestimate or underestimate distance'],'chunks':chunk_id+(1 if chunk else 0),'identity_review_file':'segments.json','source_dimensions':[ref.shape[1],ref.shape[0]],'match_id':C['match_id'],'alignment':C['alignment'],'homography':court.H.tolist(),'inverse_homography':court.Hi.tolist() if hasattr(court,'Hi') else np.linalg.inv(court.H).tolist()}
 save('summary.json',summary);progress('complete');print(json.dumps(summary),flush=True)
except Exception as e:
 traceback.print_exc();progress('failed',str(e));sys.exit(1)
