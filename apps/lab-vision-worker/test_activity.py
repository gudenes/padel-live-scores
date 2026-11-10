import unittest
from activity import detect_activity
class ActivityTests(unittest.TestCase):
 def test_empty(self):
  self.assertEqual(detect_activity([],[],[],[])['windows'],[])
 def sample(self,segments,moving=True):
  rows=[];ball=[]
  for lo,hi,seg in segments:
   for n in range(round((hi-lo)*10)):
    t=round(lo+n/10,3)
    rows.append({'source_s':t,'segment_id':seg,'players':{str(i):{'court_m':[i+(t-lo if moving else 0),i],'position_source':'observed'} for i in range(4)}})
    ball.append({'source_s':t,'kind':'detected','point':{'x':n*10,'y':20}})
  return detect_activity(rows,[],ball,segments)
 def test_activity_buffer_stays_in_camera_segment(self):
  a=self.sample([(0,5,1),(5,10,2)])
  self.assertEqual(len(a['windows']),2)
  self.assertEqual([w['segment'] for w in a['windows']],[1,2])
  self.assertLessEqual(a['windows'][0]['end'],5)
  self.assertGreaterEqual(a['windows'][1]['start'],5)
 def test_ball_alone_not_enough(self):
  self.assertEqual(self.sample([(0,5,1)],False)['windows'],[])
if __name__=='__main__':unittest.main()
