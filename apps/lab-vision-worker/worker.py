#!/usr/bin/env python3
"""Outbound-only local worker. No listening port and no cloud/GPU execution."""
import argparse,fcntl,json,os,signal,subprocess,sys,tarfile,threading,time,hashlib
from pathlib import Path
import requests
DEFAULTS={'work_dir':'/Volumes/Crucial/dev/lab-vision-jobs','pose_weights':'/Volumes/Crucial/dev/padelgod/video/models/yolo26n-pose.pt','ball_root':'/Volumes/Crucial/dev/padel-match-analysis/ball-model-tests'}
class Worker:
 def __init__(self,config):
  self.cfg={**DEFAULTS,**config};self.base=self.cfg['server'].rstrip('/')
  if not (self.base.startswith('https://') or self.base.startswith('http://localhost:')):raise ValueError('HTTPS server required')
  self.root=Path(self.cfg['work_dir']);self.root.mkdir(parents=True,exist_ok=True)
  self.lock=(self.root/'worker.lock').open('w');fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  self.stopped=threading.Event();self.guard=threading.Lock();self.progress={'stage':'preparing','processed':0,'total':1};self.job=None
 def api(self,action,**kw):
  body={'action':action,**kw}
  if self.job:body.update(id=self.job['id'],attemptId=self.job['attemptId'])
  r=requests.post(self.base+'/api/lab-vision/worker',json=body,headers={'Authorization':'Bearer '+self.cfg['token']},timeout=(10,25));r.raise_for_status();return r.json()
 def stage(self,name,done=0,total=1):
  with self.guard:self.progress={'stage':name,'processed':max(0,float(done)),'total':max(1,float(total))}
  print(name,round(done,1),'/',round(total,1),flush=True)
 def beat(self):
  last=time.monotonic()
  while not self.stopped.is_set():
   try:
    with self.guard:p=dict(self.progress)
    self.api('heartbeat',**p);last=time.monotonic()
   except requests.HTTPError as e:
    if e.response.status_code in (401,403,409):self.stopped.set();return
   except requests.RequestException:pass
   if time.monotonic()-last>65:self.stopped.set();return
   self.stopped.wait(10)
 def execute(self,cmd,progress=None,offset=0,total=1):
  with (self.folder/'pipeline.log').open('a') as log:
   proc=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   try:
    while proc.poll() is None:
     if self.stopped.wait(1):raise RuntimeError('Worker disconnected, job stopped, or heartbeat lost. Work preserved.')
     if progress and Path(progress).exists():
      try:
       p=json.loads(Path(progress).read_text())
       with self.guard:self.progress.update(processed=offset+p.get('processed_s',0),total=total)
      except (ValueError,OSError):pass
    if proc.returncode:raise RuntimeError(f'{Path(cmd[1] if len(cmd)>1 else cmd[0]).name} failed (exit {proc.returncode}). See local pipeline.log.')
   finally:
    if proc.poll() is None:
     os.killpg(proc.pid,signal.SIGTERM)
     try:proc.wait(timeout=10)
     except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
 def download(self,video):
  dest=self.folder/'original-video';expected=int(video['size'])
  if dest.exists() and dest.stat().st_size==expected:return dest
  self.stage('downloading',0,expected);tmp=dest.with_suffix('.part');n=0
  with requests.get(video['url'],stream=True,timeout=(10,30)) as r:
   r.raise_for_status()
   with tmp.open('wb') as f:
    for chunk in r.iter_content(4*1024*1024):
     if self.stopped.is_set():raise RuntimeError('Download stopped')
     f.write(chunk);n+=len(chunk)
     with self.guard:self.progress['processed']=n
  if n!=expected:raise RuntimeError('Downloaded video size does not match upload')
  tmp.replace(dest);return dest
 def perform(self,job):
  self.job=job;self.folder=self.root/job['id'];self.folder.mkdir(exist_ok=True)
  (self.folder/'job.json').write_text(json.dumps(job['setup'],indent=2));self.stopped.clear();self.stage('preparing')
  beat=threading.Thread(target=self.beat,daemon=True);beat.start()
  awake=subprocess.Popen(['caffeinate','-i','-w',str(os.getpid())])
  try:
   source=self.download(job['video'])
   os.environ['LAB_VISION_BALL_ROOT']=self.cfg['ball_root']
   from pipeline import run
   metrics=run(self.folder,job,source,self.stage,self.execute,self.cfg)
   if self.stopped.is_set():raise RuntimeError('Job stopped')
   self.stage('uploading');archive=self.folder/'results.tar.gz'
   with tarfile.open(archive,'w:gz') as tar:
    for file in sorted(self.folder.rglob('*')):
     if file.is_file() and file.suffix in ('.json','.jsonl','.jpg') and file.name!='job.json':tar.add(file,arcname=str(file.relative_to(self.folder)),recursive=False)
   size=archive.stat().st_size;url=self.api('upload',size=size)['url']
   with archive.open('rb') as f:r=requests.put(url,data=f,headers={'Content-Type':'application/gzip'},timeout=(10,600));r.raise_for_status()
   if self.stopped.is_set():raise RuntimeError('Job stopped')
   from publish import publish
   viewer=publish(self,job['setup'])
   self.api('complete',size=size,metrics=metrics,viewer=viewer);print('Analysis complete:',job['id'],flush=True)
  except Exception as e:
   print('Analysis stopped:',str(e),flush=True)
   if not self.stopped.is_set():
    try:self.api('failed',error=str(e))
    except requests.RequestException:pass
  finally:self.stopped.set();beat.join(timeout=35);awake.terminate();awake.wait();self.job=None
 def serve(self):
  print('Lab Vision worker ready; checking for your jobs.',flush=True)
  while True:
   try:
    job=self.api('claim')['job']
    if job:self.perform(job)
   except requests.RequestException as e:print('App connection unavailable:',type(e).__name__,flush=True)
   time.sleep(10)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--config',required=True);args=p.parse_args()
 file=Path(args.config).expanduser();os.chmod(file,0o600)
 Worker(json.loads(file.read_text())).serve()
