import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from features import normalize, prepare

class FeaturesTests(unittest.TestCase):
    def pose(self):
        p = np.ones((17, 3), dtype=np.float32)
        p[:, :2] *= 20
        p[[5, 6], 1] = 10
        return p

    def test_translation_scale_invariance_and_invalid_joints(self):
        p = self.pose()
        q = p.copy(); q[:, :2] = q[:, :2] * 3 + 100
        np.testing.assert_allclose(normalize(p), normalize(q))
        p[5, 2] = .1
        self.assertIsNone(normalize(p))

    def test_split_identity_and_missing_pose_remain_explicit(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); viewer = root / 'job' / 'viewer'; viewer.mkdir(parents=True)
            (viewer / 'manifest.json').write_text(json.dumps({'players': [{'id': 'hitter', 'key': 'p0'}]}))
            rows = [{'t': float(t), 'players': {'p0': self.pose().tolist()}} for t in np.linspace(1, 3, 61)]
            (viewer / '000.json').write_text(json.dumps({'poses': rows}))
            snapshot = {'id': 'snapshot', 'sha256': 'hash', 'classMapping': 'starter-eight-v3', 'split': {'m1': 'train', 'm2': 'validation', 'm3': 'test'}, 'samples': [{'id': f'a{i}', 'jobId': 'job', 'playerId': 'hitter', 'matchId': f'm{i}', 'time': 2, 'start': 1, 'end': 3, 'shot': 'Vibora'} for i in range(1, 4)]}
            snapshot['samples'].append(dict(snapshot['samples'][2], id='missing', playerId='unknown'))
            report = prepare(snapshot, root, root / 'out')
            self.assertEqual(report['counts']['test'], {'eligible': 2, 'usable': 1, 'classes': {'Overhead': 1}})
            self.assertEqual(report['skipped'][0]['annotationId'], 'missing')
            data = np.load(root / 'out' / 'features.npz')
            self.assertEqual(data['roles'].tolist(), ['train', 'validation', 'test'])
            self.assertEqual(data['x'].shape, (3, 816))
            self.assertTrue(report['canTrain'])
            self.assertFalse((root / 'out' / 'candidate.pt').exists())

if __name__ == '__main__':
    unittest.main()
