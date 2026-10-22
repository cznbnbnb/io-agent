import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import contextlib
import io
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('channel_cli',Path(__file__).with_name('io-channel-cli.py'))
cli=importlib.util.module_from_spec(spec);spec.loader.exec_module(cli)
SOURCE='chn-'+'a'*32

class ChannelCLI(unittest.TestCase):
    def test_exit_requires_the_exact_operation_and_explicit_exit_evidence(self):
        value={'schema':2,'operation':SOURCE,'sid':'','peer':'','evidence':'device_event'}
        self.assertTrue(cli.confirms_exit(value,SOURCE))
        for changed in [{'operation':'chn-'+'b'*32},{'sid':'a'*32},{'peer':'other'},{'evidence':'none'},{'schema':1}]:
            self.assertFalse(cli.confirms_exit({**value,**changed},SOURCE))

    def test_pending_ownership_never_matches_a_different_session(self):
        value={'schema':2,'operation':SOURCE,'sid':'b'*32,'peer':'synthetic','evidence':'none'}
        self.assertTrue(cli.owns_pending(value,SOURCE));self.assertFalse(cli.owns_pending(value,'chn-'+'b'*32))
        self.assertFalse(cli.owns_pending({**value,'sid':''},SOURCE))

    def test_guard_transport_timeout_is_failure_not_a_stop_ack(self):
        with patch.object(cli.subprocess,'run',side_effect=subprocess.TimeoutExpired('synthetic',3)):
            self.assertFalse(cli.guard_transfer('synthetic','synthetic','send','a','b'))

    def test_unknown_result_is_never_relabelled_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);command={'id':SOURCE}
            with patch.object(cli.transport,'transfer',return_value=False),patch.object(cli.time,'monotonic',side_effect=[1,2]):
                r=cli.poll_result('synthetic','synthetic',folder,command,seconds=.1)
            self.assertEqual(r['state'],'unknown');self.assertIn('never replay',r['next'])

    def test_guard_uses_separate_stop_lane_and_verifies_its_own_terminal_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=root/SOURCE;folder.mkdir()
            (folder/'guard.json').write_text(json.dumps({'source_id':SOURCE,'hdc':'synthetic','device':'synthetic'}),encoding='utf8')
            (folder/'command.json').write_text(json.dumps({'id':SOURCE,'action':'display-start','hold_ms':5000}),encoding='utf8')
            now=[0];calls=[]
            def transfer(hdc,device,direction,source,target,timeout=3):
                calls.append((direction,str(source),str(target)))
                if direction=='recv':
                    Path(target).write_text(json.dumps({'schema':2,'operation':SOURCE,'sid':'','peer':'','evidence':'device_event'}),encoding='utf8')
                return True
            with patch.object(cli.transport,'PRIVATE',root),patch.object(cli,'guard_transfer',side_effect=transfer),\
                 patch.object(cli.time,'monotonic',side_effect=lambda:now[0]),patch.object(cli.time,'sleep',side_effect=lambda n:now.__setitem__(0,now[0]+n)):
                cli.guard(folder/'guard.json')
            sent=[c for c in calls if c[0]=='send'];self.assertEqual(len(sent),1);self.assertTrue(sent[0][2].endswith('/channel-stop.json'))
            request=json.loads((folder/'guard-stop/command.json').read_text(encoding='utf8'));self.assertEqual(request['source_id'],SOURCE)
            result=json.loads((folder/'guard-result.json').read_text(encoding='utf8'));self.assertTrue(result['exit_confirmed']);self.assertFalse(result['stop_replayed'])

    def test_guard_refuses_to_claim_another_operations_exit(self):
        self.assertFalse(cli.confirms_exit({'schema':2,'operation':'chn-'+'b'*32,'sid':'','peer':'','evidence':'device_event'},SOURCE))

    def test_notification_target_requires_explicit_global_intent_and_cannot_mix_display_controls(self):
        base=['io-channel-cli.py','notification-timing','--binding','a'*64,'--notice-seconds','120']
        cases=[base,base+['--set-global-target','--seconds','120'],base+['--set-global-target','--profile','source-final'],
               ['io-channel-cli.py','status','--set-global-target']]
        for argv in cases:
            with patch.object(cli.sys,'argv',argv),patch.object(cli.transport,'note_local_lock') as lock,contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as result:cli.main()
                self.assertEqual(result.exception.code,2);lock.assert_not_called()

    def test_notification_snapshot_keeps_phone_target_separate_from_unknown_device_value(self):
        s={key:False for key in ('connected','foreground','active','closing','ready','blocked','can_cleanup','stop_submitted')}
        s.update({key:0 for key in ('connection','audio_packets','text_writes','started_at')})
        s.update(ack_code=-1,peer='',binding='',operation_id='',exit_operation_id='',exit_evidence='none',note='',
                 notice_can_configure=False,notice_binding='',notice_target_seconds=-1,notice_submission='none',notice_device_value_known=False)
        self.assertTrue(cli.snapshot_valid(s))
        for changed in [{'notice_device_value_known':True},{'notice_target_seconds':256},{'notice_binding':['a'*64]},{'notice_submission':'verified'}]:
            self.assertFalse(cli.snapshot_valid({**s,**changed}))

if __name__=='__main__':unittest.main()
