import sys,time,json,hashlib,subprocess,os
from pathlib import Path
import cv2,numpy as np,torch,yaml
ROOT=Path(os.environ.get('LAB_VISION_BALL_ROOT','/Volumes/Crucial/dev/padel-match-analysis/ball-model-tests')); REPO=ROOT/'WASB-SBDT';sys.path.insert(0,str(REPO/'src'))
from models import build_model
import argparse
ap=argparse.ArgumentParser();ap.add_argument('--config',required=True);C=json.loads(Path(ap.parse_args().config).read_text());P=Path(C['root']);OUT=Path(C['out']);OUT.mkdir(parents=True,exist_ok=True)
clips=[('match1',C['start'],C['duration'])]
manifest={'source':str(P/C['source']),'clips':clips,'repo_commit':subprocess.check_output(['git','-C',str(REPO),'rev-parse','HEAD'],text=True).strip(),'threshold':.5,'device':'mps','preprocessing':'RGB ImageNet normalization; 512x288; consecutive 3-frame input/output; nonoverlapping batches; no gap filling','weights':{n:hashlib.sha256((ROOT/'weights'/f'{n}.pth.tar').read_bytes()).hexdigest() for n in ['wasb']}}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
mean=np.array([.485,.456,.406],np.float32)[None,None,:];std=np.array([.229,.224,.225],np.float32)[None,None,:]
class AttrDict(dict):
 __getattr__=dict.__getitem__
def attrs(x):
 return AttrDict({k:attrs(v) for k,v in x.items()}) if isinstance(x,dict) else [attrs(v) for v in x] if isinstance(x,list) else x
for modelname in ['wasb']:
 cfg=attrs(yaml.safe_load((REPO/'src/configs/model'/f'{modelname}.yaml').read_text()));model=build_model({'model':cfg})
 ck=torch.load(ROOT/'weights'/f'{modelname}.pth.tar',map_location='cpu',weights_only=True);model.load_state_dict(ck['model_state_dict']);model.to('mps').eval();records=[];begin=time.monotonic()
 for name,start,duration in clips:
  cap=cv2.VideoCapture(str(P/C['source']));cap.set(cv2.CAP_PROP_POS_MSEC,start*1000);total=round(duration*30); writer=None
  for k in range(0,total-2,3):
   fs=[]
   for _ in range(3):
    ok,f=cap.read()
    if not ok:raise RuntimeError("Unexpected end of source")
    fs.append(cv2.resize(f,(1280,720)))
   arr=[((cv2.cvtColor(cv2.resize(f,(512,288)),cv2.COLOR_BGR2RGB).astype(np.float32)/255-mean)/std).transpose(2,0,1) for f in fs]
   x=torch.from_numpy(np.concatenate(arr,axis=0)[None]).to('mps')
   with torch.inference_mode(): heat=model(x)[0].sigmoid().cpu().numpy()[0]
   for j,hm in enumerate(heat):
    count,labels=cv2.connectedComponents((hm>.5).astype(np.uint8));candidates=[]
    for q in range(1,count):
     ys,xs=np.where(labels==q);weights=hm[ys,xs];candidates.append({'x':float(np.average(xs,weights=weights)*2.5),'y':float(np.average(ys,weights=weights)*2.5),'score':float(weights.sum()),'peak':float(weights.max())})
    best=max(candidates,key=lambda r:r['score']) if candidates else None
    records.append({'clip':name,'frame':k+j,'source_s':start+(k+j)/30,'prediction':best,'candidates':candidates,'candidate_count':len(candidates),'heatmap_peak':float(hm.max())})
    f=fs[j].copy();cv2.putText(f,f'{modelname.upper()} | {start+(k+j)/30:.2f}s | raw detections',(25,35),cv2.FONT_HERSHEY_SIMPLEX,.7,(255,255,255),2)
    if best:cv2.circle(f,(round(best['x']),round(best['y'])),11,(0,255,255),2)
    else:cv2.putText(f,'NO DETECTION',(25,65),cv2.FONT_HERSHEY_SIMPLEX,.6,(50,50,255),2)
    pass
   if k%60==0:
    print(modelname,name,k,'/',total,flush=True)
    tmp=OUT/'ball-progress.tmp';tmp.write_text(json.dumps({'state':'running','processed_s':k/30,'total_s':C['duration']}));tmp.replace(OUT/'ball-progress.json')
  cap.release()
  (OUT/f'{modelname}-all-candidates.json').write_text(json.dumps(records))
 elapsed=time.monotonic()-begin;print(modelname,'FINISHED',elapsed,flush=True)
 (OUT/f'{modelname}-candidates-summary.json').write_text(json.dumps({'frames':len(records),'frames_with_prediction':sum(r['prediction'] is not None for r in records),'wall_seconds_including_render':elapsed,'accuracy':None,'note':'Prediction availability is not accuracy. No inference or gap interpolation applied.'},indent=2))
 del model;torch.mps.empty_cache()

(OUT/'ball-progress.json').write_text(json.dumps({'state':'complete','processed_s':C['duration'],'total_s':C['duration']}))
