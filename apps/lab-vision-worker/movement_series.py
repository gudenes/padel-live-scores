"""Version 1 of the viewer's derived movement samples.

Keep in parity with scouting/movement-series.ts and movement-efforts.ts.
Derive across chunk boundaries, then partition by sample time. This does not
rerun tracking or inference and preserves observed-only gap/cut rules.
"""
import math

VERSION = 1

def observed(row, key):
    player = row.get('players', {}).get(key, {})
    xy = player.get('court_m')
    if (row.get('overlay_visible') and row.get('segment_id') is not None
            and player.get('position_source') == 'observed'
            and isinstance(xy, list) and len(xy) == 2
            and all(isinstance(n, (int, float)) and math.isfinite(n) for n in xy)):
        return xy
    return None

def speed_series(rows, key):
    samples, anchor, previous, zones, heat = [], None, None, [0, 0, 0], {}
    for row in rows:
        xy = observed(row, key)
        if xy is None:
            anchor, previous, zones, heat = None, None, [0, 0, 0], {}
            continue
        if (previous is None or row['segment_id'] != previous['segment_id']
                or not 0 < row['source_s'] - previous['source_s'] <= .15):
            anchor, zones, heat = row, [0, 0, 0], {}
        else:
            px, py = previous['players'][key]['court_m']
            dt = row['source_s'] - previous['source_s']
            if 0 <= px <= 10 and 0 <= py <= 20:
                cell = f'{min(9, math.floor(px))},{min(19, math.floor(py))}'
                heat[cell] = heat.get(cell, 0) + dt
            depth = abs(py - 10)
            if depth <= 10:
                zones[0 if depth < 5 else 1 if depth < 7 else 2] += dt
        previous = row
        if anchor is None:
            anchor = row
            continue
        dt = row['source_s'] - anchor['source_s']
        if dt < .999:
            continue
        distance = math.dist(xy, anchor['players'][key]['court_m'])
        speed = distance / dt * 3.6
        if dt <= 1.21 and speed <= 30:
            samples.append(dict(time=row['source_s'], duration=dt, speed=speed,
                                distance=distance, segment=row['segment_id'],
                                zoneSeconds=zones[:], heat=heat.copy()))
        anchor, zones, heat = row, [0, 0, 0], {}
    return samples

def motion_series(rows, key):
    samples, run, run_id = [], [], 0
    def flush():
        nonlocal run, run_id
        run_id += 1
        velocities = []
        for i, row in enumerate(run):
            centre = row['source_s']
            window = [r for r in run[max(0, i-16):i+17] if abs(r['source_s']-centre) <= .251]
            if len(window) < 5 or window[-1]['source_s'] - window[0]['source_s'] < .399:
                continue
            mean_t = sum(r['source_s'] for r in window) / len(window)
            x, y = [sum(r['players'][key]['court_m'][axis] for r in window) / len(window) for axis in (0, 1)]
            denominator = sum((r['source_s']-mean_t)**2 for r in window)
            vx, vy = [sum((r['source_s']-mean_t)*(r['players'][key]['court_m'][axis]-mean)
                          for r in window) / denominator for axis, mean in ((0, x), (1, y))]
            speed = math.hypot(vx, vy)*3.6
            if speed > 30:
                continue
            previous = next((v for v in reversed(velocities) if centre-v['time'] >= .499), None)
            dt = centre-previous['time'] if previous else 0
            acceleration = (speed-previous['speed'])/3.6/dt if previous and dt <= .61 else None
            velocities.append(dict(time=centre,
                start=max(run[0]['source_s'], previous['time']-.25) if previous else window[0]['source_s'],
                end=window[-1]['source_s'], x=x, y=y, speed=speed,
                acceleration=acceleration if acceleration is not None and abs(acceleration) <= 12 else None,
                run=run_id))
        samples.extend(velocities)
        run = []
    for row in rows:
        xy = observed(row, key)
        if xy is None:
            flush()
            continue
        if run:
            prev = run[-1]
            dt = row['source_s']-prev['source_s']
            if (row['segment_id'] != prev['segment_id'] or not 0 < dt <= .15
                    or math.dist(xy, prev['players'][key]['court_m'])/dt > 10):
                flush()
        run.append(row)
    flush()
    return samples

def movement_chunks(chunks, keys, start):
    rows = [r for i, chunk in sorted(chunks.items()) if i >= math.floor(start/60) for r in chunk['rows']]
    output = {i:dict(version=VERSION, data={k:[] for k in keys}, motion={k:[] for k in keys}) for i in chunks}
    for key in keys:
        for field, values in [('data', speed_series(rows, key)), ('motion', motion_series(rows, key))]:
            for sample in values:
                i = math.floor(sample['time']/60)
                if i in output:
                    output[i][field][key].append(sample)
    return output
