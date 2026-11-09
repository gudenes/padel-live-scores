"""Install this trusted local worker as a login agent (no model download)."""
import json,os,plistlib,shutil,subprocess,sys
from pathlib import Path
source=Path(__file__).resolve().parent
home=Path.home();state=home/'Library/Application Support/Padel Labs';state.mkdir(parents=True,exist_ok=True)
config=state/'lab-vision-worker.json'
if len(sys.argv)>1:
 incoming=Path(sys.argv[1]).expanduser();data=json.loads(incoming.read_text())
 if not all(k in data for k in ('server','token','workerId')):raise SystemExit('Invalid worker connection file')
 config.write_text(json.dumps(data));config.chmod(0o600)
if not config.exists():raise SystemExit('Provide the private connection file downloaded from the app')
install=state/'worker'
shutil.copytree(source,install,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
logs=home/'Library/Logs/Padel Labs';logs.mkdir(parents=True,exist_ok=True)
plist=home/'Library/LaunchAgents/com.padellabs.vision-worker.plist';plist.parent.mkdir(exist_ok=True)
plist.write_bytes(plistlib.dumps({'Label':'com.padellabs.vision-worker','ProgramArguments':['/bin/zsh',str(install/'start.command'),str(config)],'WorkingDirectory':str(install),'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':30,'StandardOutPath':str(logs/'worker.log'),'StandardErrorPath':str(logs/'worker-error.log')}))
subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}',str(plist)],capture_output=True)
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],check=True)
print('Lab Vision worker installed and started. It will start again at login.')
