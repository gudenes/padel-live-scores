"""Pose-only baseline inputs. No fitting and no video/model downloads."""
import json
from collections import Counter
from functools import lru_cache
from pathlib import Path
import numpy as np

CLASSES = ['Serve', 'Groundstroke', 'Volley', 'Lob', 'Smash', 'Overhead', 'Bajada', 'Contrapared']


def label(shot):
    return 'Overhead' if shot in ['Bandeja', 'Vibora', 'Gancho', 'Rulo'] else shot


def normalize(pose):
    p = np.asarray(pose, dtype=np.float32)
    if p.shape != (17, 3) or not np.isfinite(p).all():
        return None
    valid = p[:, 2] >= .3
    if valid.sum() < 8 or not valid[[5, 6, 11, 12]].all():
        return None
    origin = p[[11, 12], :2].mean(axis=0)
    scale = np.linalg.norm(p[[5, 6], :2].mean(axis=0) - origin)
    if scale < 2:
        return None
    p[:, :2] = np.clip((p[:, :2] - origin) / scale, -5, 5)
    p[:, 2] = np.clip(p[:, 2], 0, 1)
    p[~valid] = 0
    return p


def prepare(snapshot, cache, output):
    if snapshot.get('classMapping') != 'starter-eight-v3':
        raise ValueError('This baseline requires starter-eight-v3')
    samples = snapshot['samples']
    if len({s['id'] for s in samples}) != len(samples):
        raise ValueError('Duplicate annotation IDs')
    if set(snapshot['split'].values()) != {'train', 'validation', 'test'}:
        raise ValueError('Separate train, validation and test matches required')
    cache, output = Path(cache), Path(output)
    output.mkdir(parents=True, exist_ok=True)

    @lru_cache(maxsize=8)
    def read(path):
        return json.loads(Path(path).read_text())

    xs, ys, ids, roles, skipped = [], [], [], [], []
    for sample in sorted(samples, key=lambda s: (s['jobId'], s['time'])):
        viewer = cache / sample['jobId'] / 'viewer'
        reason = None
        try:
            manifest = read(str(viewer / 'manifest.json'))
            players = [p for p in manifest['players'] if p.get('id') == sample.get('playerId') and sample.get('playerId')]
            if len(players) != 1:
                raise ValueError('Hitter not mapped to tracked player')
            key = players[0]['key']
            # Use only the saved, verified clip bounds, at most 1 second each side.
            lo, hi = max(sample['start'], sample['time'] - 1), min(sample['end'], sample['time'] + 1)
            rows = []
            for chunk in range(int(lo // 60), int(hi // 60) + 1):
                for row in read(str(viewer / f'{chunk:03d}.json')).get('poses', []):
                    if lo <= row['t'] <= hi and key in row['players']:
                        pose = normalize(row['players'][key])
                        if pose is not None:
                            rows.append((row['t'], pose))
            if not rows:
                raise ValueError('No usable hitter pose in clip')
            times = np.array([r[0] for r in rows])
            frames, observed = [], 0
            for t in np.linspace(lo, hi, 16):
                nearest = np.argmin(np.abs(times - t))
                present = abs(times[nearest] - t) <= .12
                frames.append(rows[nearest][1] if present else np.zeros((17, 3), dtype=np.float32))
                observed += int(present)
            if observed < 12:
                raise ValueError('Less than 75% pose coverage')
            xs.append(np.stack(frames).flatten())
            ys.append(CLASSES.index(label(sample['shot'])))
            ids.append(sample['id'])
            roles.append(snapshot['split'][sample['matchId']])
        except (OSError, ValueError, KeyError) as error:
            reason = str(error) if not isinstance(error, OSError) else 'Cached tracking file missing'
        if reason:
            skipped.append({'annotationId': sample['id'], 'reason': reason, 'split': snapshot['split'][sample['matchId']]})
    counts = {role: {'eligible': sum(snapshot['split'][s['matchId']] == role for s in samples), 'usable': roles.count(role), 'classes': dict(Counter(CLASSES[y] for y, r in zip(ys, roles) if r == role))} for role in ['train', 'validation', 'test']}
    report = {'snapshotId': snapshot['id'], 'snapshotSha256': snapshot['sha256'], 'counts': counts, 'skipped': skipped, 'model': 'pose-mlp-v1', 'frames': 16, 'features': 816, 'canTrain': all(c['usable'] > 0 for c in counts.values())}
    np.savez_compressed(output / 'features.npz', x=np.asarray(xs, dtype=np.float32), y=np.asarray(ys, dtype=np.int64), ids=np.asarray(ids), roles=np.asarray(roles))
    (output / 'preflight.json').write_text(json.dumps(report, indent=2))
    (output / 'snapshot.json').write_text(json.dumps(snapshot))
    return report

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('snapshot'); p.add_argument('cache'); p.add_argument('output')
    a = p.parse_args()
    r = prepare(json.loads(Path(a.snapshot).read_text()), a.cache, a.output)
    print(json.dumps({k: v for k, v in r.items() if k != 'skipped'}, indent=2))
    print('Skipped:', len(r['skipped']), dict(Counter(s['reason'] for s in r['skipped'])))
