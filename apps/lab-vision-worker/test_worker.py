import unittest
from unittest.mock import patch
import requests
from worker import Worker

class WorkerErrorTests(unittest.TestCase):
 def worker(self):
  w=Worker.__new__(Worker);w.base='https://example.invalid';w.cfg={'token':'test'};w.job=None
  return w
 def test_server_validation_detail_and_status_are_preserved(self):
  r=requests.Response();r.status_code=400;r._content=b'{"error":"Invalid activity windows."}'
  with patch('worker.requests.post',return_value=r):
   with self.assertRaises(requests.HTTPError) as caught:self.worker().api('complete')
  self.assertIn('complete: Invalid activity windows.',str(caught.exception))
  self.assertIs(caught.exception.response,r)
 def test_non_json_error_remains_http_error(self):
  r=requests.Response();r.status_code=503;r._content=b'<html>Unavailable</html>'
  with patch('worker.requests.post',return_value=r):
   with self.assertRaises(requests.HTTPError) as caught:self.worker().api('complete')
  self.assertIs(caught.exception.response,r)
if __name__=='__main__':unittest.main()
