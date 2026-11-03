"""Capture official archive sources reproducibly; no database writes."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', required=True)
args = parser.parse_args()
out = Path(args.output_dir).resolve()
out.mkdir(parents=True, exist_ok=True)
base = 'https://widget.matchscorerlive.com/screen/'
urls = {'honours': 'https://www.padelfip.com/roll-of-honour-world/',
        'event2024': 'https://www.padelfip.com/events/fip-world-padel-championships-2024/',
        'groups2024': base + 'groups/FIP-2024-4403?t=tol',
        'roster2024': base + 'entrylist/FIP-2024-4403?t=tol'}
for day in range(1, 7):
    for kind, route in [('oop', 'oopbyday'), ('results', 'resultsbyday'), ('ties', 'teamresults')]:
        urls[f'{kind}2024-{day}'] = base + f'{route}/FIP-2024-4403/{day}?t=tol'
def capture(item):
    key, url = item
    path = out / f'{key}.html'
    result = subprocess.run(['curl', '-fLs', '--retry', '2', '--max-time', '30', url, '-o', str(path)], capture_output=True)
    return {'key': key, 'url': url, 'path': str(path), 'ok': result.returncode == 0}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    rows = list(pool.map(capture, urls.items()))
(out / 'manifest.json').write_text(json.dumps(rows, indent=2))
print(json.dumps({'sources': len(rows), 'failed': [r['key'] for r in rows if not r['ok']]}))
if any(not r['ok'] for r in rows):
    raise SystemExit(1)
