import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import torch
import runner

class RunnerTests(unittest.TestCase):
    def test_synthetic_run_reports_only_test_ids(self):
        # Synthetic fixtures only: never train on the user's dataset during setup.
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            np.savez_compressed(directory / 'features.npz', x=np.random.default_rng(42).normal(size=(24, 816)).astype('float32'), y=np.arange(24, dtype='int64') % 8, roles=np.array(['train']*16+['validation']*4+['test']*4), ids=np.array([f'fixture-{i}' for i in range(24)]))
            plan = {'id': 'fixture', 'attemptId': 'claim', 'model': 'pose-mlp-v1', 'epochs': 1, 'maxMinutes': 1, 'snapshotSha256': 'fixture-hash', 'snapshotId': 'fixture-snapshot'}
            with patch.object(runner, 'api', return_value={}) as api:
                runner.train({}, plan, directory)
            calls = [call.kwargs for call in api.call_args_list]
            self.assertEqual([c['action'] for c in calls], ['progress', 'complete'])
            self.assertEqual([p['annotationId'] for p in calls[1]['predictions']], [f'fixture-{i}' for i in range(20, 24)])
            self.assertTrue((directory / 'candidate.pt').exists())
            self.assertEqual(json.loads((directory / 'predictions.json').read_text())['snapshotId'], 'fixture-snapshot')

if __name__ == '__main__':
    unittest.main()
