"""Backfill derived samples from exported viewer rows, without inference or uploads."""
import json,sys
from pathlib import Path
from movement_series import movement_chunks,VERSION
root=Path(sys.argv[1])
m=json.loads((root/'source-manifest.json').read_text())
chunks={i:json.loads((root/f'source-{i:03d}.json').read_text()) for i in range(m['chunks'])}
output=movement_chunks(chunks,[p['key'] for p in m['players']],m['start'])
for i,chunk in output.items():
    (root/f'movement-{i:03d}.json').write_text(json.dumps(chunk,separators=(',',':'),allow_nan=False))
m['movement']={'version':VERSION,'chunks':m['chunks'],'timebase':'source-video-seconds'}
(root/'manifest.json').write_text(json.dumps(m,separators=(',',':'),allow_nan=False))
print(json.dumps({'movementChunks':len(output),'speedSamples':sum(len(v) for c in output.values() for v in c['data'].values()),'motionSamples':sum(len(v) for c in output.values() for v in c['motion'].values())}))
