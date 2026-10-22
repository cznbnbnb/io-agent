import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('settings_cli',Path(__file__).with_name('io-settings-cli.py'))
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)

class SettingsCliTest(unittest.TestCase):
    def test_original_led_one_and_full_group_only(self):
        self.assertTrue(cli.valid_values('privacy',dict(mic_on=1,led_level=1,led_auto=1,log_on=0)))
        self.assertFalse(cli.valid_values('privacy',dict(mic_on=1,led_level=1)))
        self.assertFalse(cli.valid_values('sleep',dict(seconds=True)))

    def test_unbound_or_misleading_receipt_is_rejected(self):
        command=dict(schema=1,id='dev-'+'a'*32,action='read',expires_at=1)
        receipt=dict(schema=1,id=command['id'],request_json=json.dumps(command),state='complete',effect_verified=False)
        with self.assertRaises(ValueError):cli.validate_receipt(receipt,command)
        receipt['state']='error';self.assertIs(cli.validate_receipt(receipt,command),receipt)
        receipt['effect_verified']=True
        with self.assertRaises(ValueError):cli.validate_receipt(receipt,command)

if __name__=='__main__':unittest.main()
