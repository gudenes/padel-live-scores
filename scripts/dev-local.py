#!/usr/bin/env python3
"""Run one local preview with bounded resources; stop its process group on excess."""
import os
import fcntl
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
target = sys.argv[1] if len(sys.argv) == 2 else ''
if target not in ('app', 'admin'):
    raise SystemExit('Usage: python3 scripts/dev-local.py app|admin')
workdir = ROOT if target == 'app' else ROOT / 'apps/ops'
port = '3012' if target == 'app' else '3014'
lock_path = ROOT / '.local/dev-preview.lock'
lock_path.parent.mkdir(exist_ok=True)
lock = lock_path.open('a')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit('A guarded preview is already running. Stop it before starting another.')
env = dict(os.environ, NODE_OPTIONS='--max-old-space-size=1536', RAYON_NUM_THREADS='2', UV_THREADPOOL_SIZE='2')
child = subprocess.Popen(['node', str(workdir / 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', port], cwd=workdir, env=env, start_new_session=True)

def stop(*_):
    try: os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError: pass
    try: child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try: os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError: pass
    raise SystemExit(1)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
peak_count = peak_kb = 0
print(f'{target}: Webpack preview, 12-process / 3 GiB resident-memory guard.', flush=True)
while child.poll() is None:
    try:
        rows = subprocess.check_output(['ps', '-axo', 'pgid=,rss='], text=True, timeout=3).splitlines()
        memory = [int(parts[1]) for row in rows if len(parts := row.split()) == 2 and int(parts[0]) == child.pid]
        count, kb = len(memory), sum(memory)
        peak_count, peak_kb = max(peak_count, count), max(peak_kb, kb)
        if count > 12 or kb > 3 * 1024 * 1024:
            print(f'Stopping {target}: {count} processes, {kb // 1024} MiB resident memory.', flush=True)
            stop()
    except (subprocess.SubprocessError, ValueError):
        print('Resource monitor unavailable; stopping preview.', flush=True)
        stop()
    time.sleep(2)
print(f'Peak: {peak_count} processes, {peak_kb // 1024} MiB.', flush=True)
sys.exit(child.returncode)
