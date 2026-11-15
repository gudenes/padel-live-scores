import json
import tempfile
import unittest
from pathlib import Path
from publish import package

class MovementPublicationTests(unittest.TestCase):
    def test_package_publishes_versioned_movement(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            names = ['a', 'b', 'c', 'd']
            rows = [dict(source_s=59+i/10, overlay_visible=True, segment_id=1,
                         players={n:dict(court_m=[2+i/100,15],position_source='observed') for n in names}) for i in range(30)]
            files = {'data.json':dict(rows=rows,metrics={n:dict(distance_m=1,max_speed_kmh=3.6) for n in names},zone_schema={}),
                     'tracking-summary.json':dict(source_dimensions=[1920,1080],homography=[[1,0,0],[0,1,0],[0,0,1]],inverse_homography=[[1,0,0],[0,1,0],[0,0,1]]),
                     'wasb-refined-trajectory.json':[]}
            for name,value in files.items():
                (root/name).write_text(json.dumps(value))
            manifest = package(root,dict(matchStart=59,duration=62,analysisSeconds=3,playerNames=names,offset=0))
            self.assertEqual(manifest['movement'],dict(version=1,chunks=2,timebase='source-video-seconds'))
            parts = [json.loads((root/'viewer'/f'movement-{i:03d}.json').read_text()) for i in range(2)]
            self.assertTrue(parts[0]['motion']['p0'])
            self.assertTrue(parts[1]['motion']['p0'])
            self.assertTrue(any(s['start']<60<s['end'] for c in parts for s in c['motion']['p0']))
            self.assertEqual(manifest, json.loads((root/'viewer'/'manifest.json').read_text()))

if __name__=='__main__':
    unittest.main()
