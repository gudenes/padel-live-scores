#!/usr/bin/env python3
"""Run one local preview with bounded resources; stop its process group on excess."""
import os
import fcntl
import signal
import subprocess
import sys
import time
import threading
import urllib.request
import urllib.error
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
env = dict(os.environ, PADEL_LOCAL_PREVIEW='1', NODE_OPTIONS='--max-old-space-size=2304', RAYON_NUM_THREADS='2', UV_THREADPOOL_SIZE='2')
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
def warm_play():
    """Compile read-only entry routes before review; never impersonate a user."""
    base = f'http://127.0.0.1:{port}'
    routes = ['/api/auth/session', '/es/play', '/api/play/onboarding',
              '/api/play/markets', '/api/play/me', '/api/play/leaderboard?period=week&week=0']
    for route in routes:
        timeouts = 0
        for attempt in range(60):
            if child.poll() is not None:
                return
            try:
                with urllib.request.urlopen(base + route, timeout=120) as response:
                    response.read()
                break
            except urllib.error.HTTPError as error:
                # Protected endpoints intentionally reject this anonymous warmup.
                if error.code in (401, 403, 404):
                    break
                print(f'Warmup failed for {route}: HTTP {error.code}', flush=True)
                return
            except urllib.error.URLError:
                if attempt == 59:
                    print('Preview warmup could not connect.', flush=True)
                    return
                time.sleep(1)
            except TimeoutError:
                timeouts += 1
                if timeouts >= 3:
                    print(f'Preview warmup timed out: {route}', flush=True)
                    return
                print(f'Still compiling {route}; retrying warmup.', flush=True)
        print(f'Warmed {route}', flush=True)
    print(f'Play preview ready for review: {base}/es/play', flush=True)

if target == 'app':
    threading.Thread(target=warm_play, daemon=True).start()

peak_count = peak_kb = 0
monitor_failures = 0
print(f'{target}: Webpack preview, 12-process / 3 GiB resident-memory guard.', flush=True)
while child.poll() is None:
    try:
        rows = subprocess.check_output(['ps', '-axo', 'pgid=,rss='], text=True, timeout=10).splitlines()
        memory = [int(parts[1]) for row in rows if len(parts := row.split()) == 2 and int(parts[0]) == child.pid]
        count, kb = len(memory), sum(memory)
        monitor_failures = 0
        peak_count, peak_kb = max(peak_count, count), max(peak_kb, kb)
        if count > 12 or kb > 3 * 1024 * 1024:
            print(f'Stopping {target}: {count} processes, {kb // 1024} MiB resident memory.', flush=True)
            stop()
    except (subprocess.SubprocessError, ValueError):
        monitor_failures += 1
        print(f'Resource monitor unavailable ({monitor_failures}/3).', flush=True)
        if monitor_failures >= 3:
            print('Stopping preview after repeated monitoring failures.', flush=True)
            stop()
    time.sleep(2)
print(f'Peak: {peak_count} processes, {peak_kb // 1024} MiB.', flush=True)
sys.exit(child.returncode)
