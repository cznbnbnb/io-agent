"""Freeze later 0.1.74 native evidence; never rewrite historical build freezes.

Read-only on retained native inputs. Public output contains bounded metadata,
hashes and synthetic titles, without private UI, audio, peer or credentials.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
EVIDENCE = PHASE / 'device-private/catalog074-evidence'
COLD = PHASE / 'device-private/catalog074-cold-evidence'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def summarize():
    install = read(EVIDENCE / 'install-ledger.json')
    cold = read(COLD / 'cold-ledger.json')
    build = read(PHASE / 'catalog074-build-freeze-2026-10-15.json')
    audit_path = PHASE / 'catalog074-post-native-source-audit-2026-10-15.json'
    audit = read(audit_path)
    assert audit['passed'] and audit['runId'] == build['runId'] and audit['baselineFiles'] == 774
    assert install['installed'] and install['version'] == cold['version'] == build['version'] == '0.1.74'
    assert install['version_code'] == 10074
    assert install['pid_before'] != install['pid_after'] == cold['pid_before']
    assert cold['pid_before'] != cold['pid_after']
    assert install['hap_sha256'] == build['signedHapSha256']
    assert digest(PHASE / 'artifacts/entry-default-signed-0.1.74.hap') == install['hap_sha256']
    fixture = read(EVIDENCE / 'fixture-B.json')
    assert fixture == {'synthetic': True, 'unsaved': True, 'title': '标题增量测试乙', 'utf8_bytes': 225}
    preservation = {}
    for key, expected in install['retained_hashes'].items():
        before, after = EVIDENCE / f'before-{key}.bin', EVIDENCE / f'after-{key}.bin'
        assert before.read_bytes() == after.read_bytes()
        assert digest(before) == expected == digest(after)
        cold_before, cold_after = COLD / f'before-{key}.bin', COLD / f'after-{key}.bin'
        assert cold_before.read_bytes() == cold_after.read_bytes()
        assert digest(cold_before) == cold['retained_hashes'][key] == digest(cold_after)
        if key != 'catalog':
            assert digest(cold_after) == expected
        preservation[key] = {'installSha256': expected, 'unchangedAcrossInstall': True,
                             'postBSha256': digest(cold_after), 'unchangedAcrossColdRestart': True}
    original = read(EVIDENCE / 'after-catalog.bin')
    after_b = read(EVIDENCE / 'post-B-catalog.json')
    assert original['schema'] == after_b['schema'] == 1
    assert len(original['items']) == 2 and len(after_b['items']) == 3
    assert after_b['items'][:2] == original['items']
    assert digest(EVIDENCE / 'post-B-catalog.json') == cold['retained_hashes']['catalog']
    new_item = after_b['items'][-1]
    assert new_item['title'] == fixture['title']
    raw = EVIDENCE / 'round-B-final-private.log'
    owned = [line for line in raw.read_text(encoding='utf-8-sig').splitlines()
             if re.search(r'\s' + re.escape(install['pid_after']) + r'\s', line)
             and '/org.turboio.harmony.research/TurboIO:' in line]
    sent = [line for line in owned if 'prompter catalog tx ' in line]
    assert len(sent) == 1
    match = re.search(r'did=([0-9a-f-]{36}) operation=batchAdd count=1 owned=3$', sent[0])
    assert match and match[1] == new_item['did']
    did = match[1]
    selected = [line for line in owned if f'did={did} ' in line]

    def event(fragment):
        hits = [line for line in selected if fragment in line]
        assert hits, fragment
        return hits[-1].split()[1]

    times = {'prepareResponse': event('type=2 action=2 code=1'),
             'fileCompleteResponse': event(f'file-rx did={did} type=5 match=true'),
             'businessReady': event('type=2 action=2 code=7'),
             'jointReady': event('phase=ready progress=100'),
             'catalogWriteCompleted': sent[0].split()[1],
             'startResponse': event('type=3 action=2 code=1'),
             'exitResponse': event('type=6 action=2 code=1')}
    idle = [line for line in owned if 'prompter state did= phase=idle ' in line]
    assert idle and idle[-1].split()[1] >= times['exitResponse']
    times['idle'] = idle[-1].split()[1]
    assert times['fileCompleteResponse'] <= times['jointReady'] <= times['catalogWriteCompleted'] < times['startResponse'] < times['exitResponse']
    cold_raw = COLD / 'cold-private.log'
    new_lines = [line for line in cold_raw.read_text(encoding='utf-8-sig').splitlines()
                 if re.search(r'\s' + re.escape(cold['pid_after']) + r'\s', line)]
    assert len(new_lines) == cold['new_pid_log_lines'] > 0
    assert not any(re.search('prompter catalog tx|prompter prepare', line) for line in new_lines)
    assert cold['automatic_prompter_send_lines'] == 0 and cold['asr_idle_after']
    result = {
        'kind': 'native_catalog074_upgrade_second_delta_and_bounded_cold_restart',
        'version': '0.1.74', 'versionCode': 10074, 'date': '2026-10-15', 'timezone': 'Asia/Shanghai',
        'runId': build['runId'], 'signedHapSha256': install['hap_sha256'],
        'postNativeSourcePathAndHashAuditPassed': True, 'postNativeSourceAuditSha256': digest(audit_path),
        'actualCoverInstall': True, 'installAtUtc': install['at'], 'synthetic': True, 'unsaved': True,
        'fixtureTitle': fixture['title'], 'utf8Bytes': 225, 'did': did, 'mode': 2,
        'fileBusiness': 17, 'catalogBusiness': 20, 'catalogOuterType': 1, 'catalogAction': 2, 'catalogInnerType': 3,
        'timestamps': times, 'catalogTransmitLogCountForInstalledProcess': 1,
        'preexistingAppOwnedRowsIndependentlyRead': 2, 'postRoundAppOwnedRowsIndependentlyRead': 3,
        'preexistingAppOwnedRowsUnchanged': True, 'startAndExitDeviceResponses': True,
        'finalObservedSessionIdle': True, 'preservation': preservation,
        'coldRestart': {'processChanged': True, 'observedFromUtc': cold['observed_from'],
                        'observedUntilUtc': cold['observed_until'], 'newPidLogLines': len(new_lines),
                        'automaticPrompterSendLinesInObservation': 0, 'asrQueueIdle': True},
        'nativeLogSha256': digest(raw), 'coldLogSha256': digest(cold_raw),
        'historicalBuildFreezeUnmodified': True, 'titleLensVerified': False,
        'unknownGlassesInventoryPreservedVerified': False, 'base08Accepted': False,
        'limits': 'Only App-owned rows and sampled protected files were independently read. GATT writes and file/control replies do not prove lens titles or unknown glasses inventory. No automatic resend was observed only in the recorded cold-start interval; this is not a long-duration or reconnect acceptance.'
    }
    (PHASE / 'catalog074-native-2026-10-15.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    report = summarize()
    print(json.dumps({'version': report['version'], 'ownedRows': report['postRoundAppOwnedRowsIndependentlyRead'],
                      'coldRestartVerified': True, 'lensVerified': False}, ensure_ascii=False))
