import importlib.util,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('ota_cli',Path(__file__).with_name('io-firmware-cli.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_start_is_explicit_and_bound(self):
  with self.assertRaises(ValueError):m.command('start')
  c=m.command('start','a'*64,now=10,identifier='fw-'+'1'*32)
  self.assertEqual(c['expires_at'],70000);self.assertEqual(c['candidate_sha256'],m.SHA)
 def test_release_never_claims_lens(self):
  with self.assertRaises(ValueError):m.command('release','a'*64,'user_confirmed_suggest60_lens')
  self.assertEqual(m.command('release','a'*64,'readback_verified_release_for_lens_check')['action'],'release')
 def test_closed_input(self):
  for action in ['flash-url','reset','cancel','retry']:
   with self.assertRaises(ValueError):m.command(action)
  self.assertEqual(len(m.proofs()),16)
if __name__=='__main__':unittest.main()
