import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('remote_release', Path(__file__).with_name('remote-server-release.py'))
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class SwitchTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.gettempdir()).resolve()
        self.root = Path(tempfile.mkdtemp(prefix='turboio-code-switch-', dir=self.base)).resolve()
        self.addCleanup(self.cleanup)
        self.current, self.stage, self.backup, self.rejected = [self.root / n for n in ('current', 'stage', 'backup', 'rejected')]
        for path, text in ((self.current, 'old'), (self.stage, 'new')):
            path.mkdir()
            (path / 'source').write_text(text)
        self.data = self.root / 'synthetic-user-data'
        self.data.write_text('revision1')
        self.events, self.started = [], []
        self.stop_failure = False
        self.on_record = lambda phase: None
        self.on_health = lambda version: None
        self.on_stop = lambda: None

    def cleanup(self):
        if self.root.parent != self.base or not self.root.name.startswith('turboio-code-switch-') or self.root.is_symlink():
            raise ValueError('TEST_CLEANUP_OUT_OF_SCOPE')
        shutil.rmtree(self.root)

    def matches(self, path, version):
        return path.is_dir() and (path / 'source').is_file() and (path / 'source').read_text() == version

    def switch(self):
        def stop():
            self.events.append('stop')
            if self.stop_failure:
                raise ValueError('SERVICE_EXIT_NOT_CONFIRMED')
            self.on_stop()

        def start():
            self.started.append((self.current / 'source').read_text())
            self.events.append('start')

        def health(version):
            self.events.append('health_' + version)
            self.on_health(version)

        def record(phase):
            self.events.append(phase)
            self.on_record(phase)

        return remote.CodeSwitch(self.current, self.stage, self.backup, self.rejected,
                                 self.matches, stop, start, health, record, lambda path: None)

    def test_complete_directory_switch_retains_old_code_and_data(self):
        switch = self.switch()
        switch.activate()
        self.assertEqual(self.started, ['new'])
        self.assertTrue(self.matches(self.backup, 'old'))
        self.assertEqual(self.data.read_text(), 'revision1')
        self.assertLess(self.events.index('service_stopped'), self.events.index('old_moved'))
        self.assertEqual(self.events[-1], 'deployed')

    def test_failed_new_health_rolls_back_code_but_keeps_new_data(self):
        def health(version):
            if version == 'new':
                self.data.write_text('revision2')
                raise ValueError('NEW_HEALTH_FAILED')
        self.on_health = health
        switch = self.switch()
        with self.assertRaisesRegex(ValueError, 'NEW_HEALTH_FAILED'):
            switch.activate()
        switch.rollback()
        self.assertEqual(self.started, ['new', 'old'])
        self.assertTrue(self.matches(self.current, 'old'))
        self.assertTrue(self.matches(self.rejected, 'new'))
        self.assertEqual(self.data.read_text(), 'revision2')
        self.assertEqual(self.events[-1], 'rolled_back')

    def test_interruption_after_old_move_is_recovered_from_actual_paths(self):
        def record(phase):
            if phase == 'old_moved':
                raise ValueError('OBSERVATION_INTERRUPTED')
        self.on_record = record
        switch = self.switch()
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_INTERRUPTED'):
            switch.activate()
        switch.rollback()
        self.assertTrue(self.matches(self.current, 'old'))
        self.assertTrue(self.matches(self.stage, 'new'))
        self.assertEqual(self.started, ['old'])

    def test_interruption_after_install_is_not_mistaken_for_no_change(self):
        def record(phase):
            if phase == 'new_installed':
                raise ValueError('OBSERVATION_INTERRUPTED')
        self.on_record = record
        switch = self.switch()
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_INTERRUPTED'):
            switch.activate()
        switch.rollback()
        self.assertTrue(self.matches(self.current, 'old'))
        self.assertTrue(self.matches(self.rejected, 'new'))

    def test_source_changed_before_stop_refuses_to_stop_or_overwrite(self):
        (self.current / 'source').write_text('third-party')
        switch = self.switch()
        with self.assertRaisesRegex(ValueError, 'SOURCE_CONFLICT_BEFORE_STOP'):
            switch.activate()
        self.assertNotIn('stop', self.events)
        self.assertEqual(self.started, [])
        self.assertEqual((self.current / 'source').read_text(), 'third-party')

    def test_source_changed_after_stop_requires_inspection_and_is_never_overwritten(self):
        self.on_stop = lambda: (self.current / 'source').write_text('third-party')
        switch = self.switch()
        with self.assertRaisesRegex(ValueError, 'SOURCE_CONFLICT_AFTER_STOP'):
            switch.activate()
        with self.assertRaisesRegex(ValueError, 'ROLLBACK_SOURCE_CONFLICT'):
            switch.rollback()
        self.assertEqual((self.current / 'source').read_text(), 'third-party')
        self.assertEqual(self.started, [])

    def test_source_changed_after_start_refuses_rollback_over_another_writer(self):
        self.on_health = lambda version: (self.current / 'source').write_text('third-party')
        switch = self.switch()
        with self.assertRaisesRegex(ValueError, 'SOURCE_CONFLICT_AFTER_START'):
            switch.activate()
        with self.assertRaisesRegex(ValueError, 'ROLLBACK_SOURCE_CONFLICT'):
            switch.rollback()
        self.assertEqual((self.current / 'source').read_text(), 'third-party')
        self.assertTrue(self.matches(self.backup, 'old'))

    def test_unconfirmed_exit_never_starts_another_service(self):
        self.stop_failure = True
        switch = self.switch()
        with self.assertRaisesRegex(ValueError, 'SERVICE_EXIT_NOT_CONFIRMED'):
            switch.activate()
        with self.assertRaisesRegex(ValueError, 'SERVICE_EXIT_NOT_CONFIRMED'):
            switch.rollback()
        self.assertEqual(self.started, [])
        self.assertTrue(self.matches(self.current, 'old'))

    def test_existing_backup_refuses_activation_without_stopping_service(self):
        self.backup.mkdir()
        switch = self.switch()
        with self.assertRaisesRegex(ValueError, 'BACKUP_ALREADY_EXISTS'):
            switch.activate()
        self.assertNotIn('stop', self.events)
        self.assertEqual(self.started, [])


class AdditiveSchemaTests(unittest.TestCase):
    def setUp(self):
        self.base=Path(tempfile.gettempdir()).resolve()
        for name,value in [('O_NOFOLLOW',getattr(remote.os,'O_NOFOLLOW',0)),('fchmod',getattr(remote.os,'fchmod',lambda _fd,_mode:None))]:
            replacement=patch.object(remote.os,name,value,create=True);replacement.start();self.addCleanup(replacement.stop)
        self.root=Path(tempfile.mkdtemp(prefix='turboio-additive-schema-',dir=self.base)).resolve()
        self.addCleanup(self.cleanup)
        (self.root/'docs/contracts').mkdir(parents=True)
        self.name='docs/contracts/event-v1.2.schema.json'
        self.payload=b'{"synthetic_schema":true}\n'

    def cleanup(self):
        if self.root.parent!=self.base or not self.root.name.startswith('turboio-additive-schema-') or self.root.is_symlink():
            raise ValueError('TEST_CLEANUP_OUT_OF_SCOPE')
        shutil.rmtree(self.root)

    def publish(self,expected):
        # Windows lacks Linux's O_NOFOLLOW/directory fsync. Only this helper's
        # exclusive create/hash/overwrite rules are exercised locally here.
        with patch.object(remote.os,'O_NOFOLLOW',getattr(remote.os,'O_NOFOLLOW',0),create=True),patch.object(remote,'sync_dir',lambda _path:None):
            return remote.publish_additive_contract(self.root,self.name,self.payload,expected)

    def test_only_the_fixed_new_schema_is_published_exclusively(self):
        self.assertTrue(self.publish(None))
        self.assertEqual((self.root/self.name).read_bytes(),self.payload)
        self.assertEqual(remote.verify_contracts(self.root,[self.name],{self.name:remote.sha(self.payload)}),{self.name:remote.sha(self.payload)})

    def test_existing_unknown_schema_is_never_overwritten(self):
        target=self.root/self.name;target.write_bytes(b'third-party-schema')
        with self.assertRaisesRegex(ValueError,'ADDITIVE_SCHEMA_CHANGED'):self.publish(None)
        self.assertEqual(target.read_bytes(),b'third-party-schema')

    def test_identical_existing_schema_is_retained_without_rewrite(self):
        target=self.root/self.name;target.write_bytes(self.payload);before=target.stat().st_mtime_ns
        self.assertFalse(self.publish(remote.sha(self.payload)))
        self.assertEqual(target.stat().st_mtime_ns,before)

    def test_old_schema_or_changed_contract_generation_is_refused(self):
        with self.assertRaisesRegex(ValueError,'ADDITIVE_SCHEMA_SCOPE_INVALID'):
            remote.publish_additive_contract(self.root,'docs/contracts/event-v1.1.schema.json',self.payload,None)
        (self.root/self.name).write_bytes(self.payload)
        with self.assertRaisesRegex(ValueError,'SHARED_SCHEMA_CHANGED'):
            remote.verify_contracts(self.root,[self.name],{self.name:'a'*64})


if __name__ == '__main__':
    unittest.main()
