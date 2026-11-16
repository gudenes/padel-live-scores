"""Opt-in local training. Connecting never trains; the operator must approve in Lab Vision."""
import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlparse


def api(config, **body):
    server = config['server'].rstrip('/')
    if urlparse(server).scheme != 'https':
        raise ValueError('HTTPS server required')
    req = Request(server + '/api/lab-vision/training-worker', data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'})
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def train(config, plan, directory):
    import numpy as np
    import torch
    from features import CLASSES
    torch.set_num_threads(2)
    torch.manual_seed(42)
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    data = np.load(directory / 'features.npz', allow_pickle=False)
    x, y = torch.tensor(data['x']), torch.tensor(data['y'])
    masks = {role: torch.tensor(data['roles'] == role) for role in ['train', 'validation', 'test']}
    if not all(m.any() for m in masks.values()):
        raise ValueError('Each split must have usable poses')
    # Pose geometry is normalized per frame. No dataset-wide/test statistics are used.
    train_x, train_y = x[masks['train']].to(device), y[masks['train']].to(device)
    val_x, val_y = x[masks['validation']].to(device), y[masks['validation']].to(device)
    model = torch.nn.Sequential(torch.nn.Linear(816, 128), torch.nn.ReLU(), torch.nn.Dropout(.25), torch.nn.Linear(128, len(CLASSES))).to(device)
    counts = torch.bincount(train_y.cpu(), minlength=len(CLASSES)).float()
    weights = (counts.sum() / (len(CLASSES) * counts.clamp(min=1))).clamp(max=10).to(device)
    loss_fn = torch.nn.CrossEntropyLoss(weight=weights)
    opt = torch.optim.AdamW(model.parameters(), lr=.001, weight_decay=.01)
    best, best_state = float('inf'), None
    started, history = time.monotonic(), []
    for epoch in range(1, plan['epochs'] + 1):
        model.train()
        order = torch.randperm(len(train_y))
        losses = []
        for indexes in order.split(64):
            if time.monotonic() - started >= plan['maxMinutes'] * 60:
                raise TimeoutError('Local wall-time limit reached; no automatic retry')
            opt.zero_grad()
            batch = indexes.to(device)
            loss = loss_fn(model(train_x[batch]), train_y[batch])
            loss.backward(); opt.step()
            losses.append(float(loss.detach().cpu()))
        model.eval()
        with torch.no_grad():
            val_loss = float(loss_fn(model(val_x), val_y).cpu())
        if val_loss < best:
            best = val_loss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        progress = {'epoch': epoch, 'loss': float(np.mean(losses)), 'validationLoss': val_loss}
        history.append(progress)
        (directory / 'history.json').write_text(json.dumps(history, indent=2))
        # Cancelled/revoked plans stop here; never continue silently offline.
        api(config, action='progress', id=plan['id'], attemptId=plan['attemptId'], **progress)
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        probabilities = model(x[masks['test']].to(device)).softmax(dim=1).cpu()
    predictions = [{'annotationId': str(id_), 'shot': CLASSES[int(p.argmax())], 'confidence': float(p.max())} for id_, p in zip(data['ids'][data['roles'] == 'test'], probabilities)]
    torch.save({'state_dict': best_state, 'classes': CLASSES, 'model': plan['model'], 'snapshotSha256': plan['snapshotSha256'], 'snapshotId': plan['snapshotId'], 'seed': 42, 'bestValidationLoss': best, 'torchVersion': torch.__version__}, directory / 'candidate.pt')
    (directory / 'predictions.json').write_text(json.dumps({'snapshotId': plan['snapshotId'], 'predictions': predictions}, indent=2))
    api(config, action='complete', id=plan['id'], attemptId=plan['attemptId'], predictions=predictions)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', required=True)
    p.add_argument('--snapshot', required=True)
    p.add_argument('--cache', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--execute-claim', help=argparse.SUPPRESS)
    args = p.parse_args()
    config = json.loads(Path(args.config).read_text())
    directory = Path(args.output) / args.snapshot
    directory.mkdir(parents=True, exist_ok=True)
    if args.execute_claim:
        plan = json.loads(Path(args.execute_claim).read_text())
        train(config, plan, directory)
        return
    lock = (Path(args.output) / 'runner.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    from features import prepare
    snapshot = api(config, action='snapshot', snapshotId=args.snapshot)
    saved = directory / 'snapshot.json'
    if saved.exists() and json.loads(saved.read_text()) != snapshot:
        raise ValueError('Cached snapshot differs from server; inspect before preparing')
    report = prepare(snapshot, args.cache, directory)
    import torch
    hardware = 'Apple Silicon · Metal GPU' if torch.backends.mps.is_available() else 'CPU'
    plan = api(config, action='prepare', snapshotId=args.snapshot, report=report, hardware=hardware)
    (directory / 'plan.json').write_text(json.dumps(plan, indent=2))
    print('Connected local pose baseline. Cloud cost EUR 0. Waiting for explicit approval in Lab Vision.', flush=True)
    while True:
        try:
            state = api(config, action='poll', id=plan['id'])
            if state.get('claimed'):
                claim = directory / 'claim.json'
                claim.write_text(json.dumps(state))
                # Parent enforces wall time even if a GPU operation or child hangs.
                try:
                    command = [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--execute-claim', str(claim)]
                    subprocess.run(command, check=True, timeout=state['maxMinutes'] * 60)
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                    try:
                        api(config, action='failed', id=state['id'], attemptId=state['attemptId'], error='Local process stopped or reached its 30-minute limit. Inspect the local log before preparing another run.')
                    except Exception:
                        print('Could not report stop; run will appear offline. No automatic retry.', flush=True)
            elif state['status'] in ['complete', 'failed', 'cancelled']:
                print('Run status: ' + state['status'], flush=True)
                return
            elif state['status'] == 'running':
                # A previous process died after claiming. Never repeat training automatically.
                api(config, action='failed', id=state['id'], attemptId=state['attemptId'], error='Local runner restarted after claim. Training was not automatically retried.')
        except Exception as error:
            print('Connection unavailable (' + type(error).__name__ + '); no new training started.', flush=True)
        time.sleep(15)

if __name__ == '__main__':
    main()
