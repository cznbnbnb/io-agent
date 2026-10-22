"""Freeze one real phone/cloud/Hermes scenario from retained independent evidence.

No device, network, model or credentials are operated by this summarizer. Inputs
remain private; public output contains synthetic identifiers, hashes and facts.
"""
import hashlib
import json
from pathlib import Path
import sqlite3
from datetime import datetime

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
PRIVATE = PHASE / 'device-private'
EVIDENCE = PRIVATE / 'task075-evidence'
COLD = PRIVATE / 'task075-cold-evidence'
RUN_ID = '20261015-104344691-185a27cd'
RUNTIME_ID = 'phone075-20261015-a'
RUNTIME = ROOT / ('rebuild/agent-bridge/private/phone-' + RUNTIME_ID)


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def walk(node):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value)


def visible_text(path, kind=None):
    return [node['attributes'].get('text', '') for node in walk(read(path))
            if isinstance(node.get('attributes'), dict)
            and node['attributes'].get('visible') == 'true'
            and (kind is None or node['attributes'].get('type') == kind)]


def summarize():
    build = read(PHASE / 'candidate-runs' / RUN_ID / 'status.json')
    signature = read(PHASE / 'candidate-runs' / RUN_ID / 'sign-finalization-status.json')
    audit = read(PHASE / 'task075-source-audit-2026-10-15.json')
    post_audit = read(PHASE / 'task075-post-native-source-audit-2026-10-15.json')
    assert build['phase'] == 'complete' and build['compileSucceeded'] and build['versionName'] == '0.1.75'
    assert signature['verified'] and signature['nativeSignature']['verified']
    assert audit['passed'] and audit['runId'] == RUN_ID and audit['baselineFiles'] == 778
    assert post_audit['passed'] and post_audit['runId'] == RUN_ID and post_audit['baselineFiles'] == 778
    signed = PHASE / 'artifacts/entry-default-signed-0.1.75.hap'
    assert digest(signed) == signature['hap']['sha256'].lower()
    assert signed.stat().st_size == signature['hap']['bytes']
    install, cold = read(EVIDENCE / 'install-ledger.json'), read(COLD / 'cold-ledger.json')
    assert install['installed'] and install['version_code'] == 10075 and install['version'] == cold['version'] == '0.1.75'
    assert install['hap_sha256'] == digest(signed) and install['pid_before'] != install['pid_after'] == cold['pid_before']
    assert cold['pid_before'] != cold['pid_after'] and cold['task_outbox_immutable_and_stored']
    assert cold['task_completed_and_request_answered_restored']
    preservation = {}
    for key, expected in install['retained_hashes'].items():
        paths = [EVIDENCE / f'before-{key}.bin', EVIDENCE / f'after-{key}.bin',
                 COLD / f'before-{key}.bin', COLD / f'after-{key}.bin']
        assert all(digest(path) == expected for path in paths)
        preservation[key] = {'sha256': expected, 'unchangedAcrossInstallAndScenarioAndColdRestart': True}
    command, answer = read(EVIDENCE / 'delegate-intent.json'), read(EVIDENCE / 'answer-intent.json')
    assert datetime.fromisoformat(answer['at'].replace('Z', '+00:00')).timestamp() > (EVIDENCE / 'mailbox-after-delegate.json').stat().st_mtime
    assert read(PHASE / 'task075-runtime-preparation-2026-10-15.json')['profile'] == 'io-question-cli-v1'
    before = read(EVIDENCE / 'mailbox-after-delegate.json')
    after = read(EVIDENCE / 'mailbox-after-answer.json')
    cloud = read(EVIDENCE / 'cloud-readback-private.json')
    assert before['principal'] == after['principal']
    assert after['principal']['ownerId'] == 'synthetic-cloud-' + RUNTIME_ID
    assert len(before['outbox']) == 1 and len(after['outbox']) == 2
    assert all(row['state'] == 'server_stored' and row['ack'] for row in after['outbox'])
    events = {json.loads(row['payload'])['kind']: json.loads(row['payload']) for row in after['outbox']}
    task_event, answer_event = events['task'], events['answer']
    task_id, request_id = task_event['body']['task_id'], answer['request_id']
    route = task_event['body']['route']
    assert task_event['producer_id'] == answer_event['producer_id'] == 'cloud-phone'
    assert task_event['body']['command'] == command['command'] and task_event['body']['allow_create_session'] is False
    assert answer_event['body']['request_id'] == request_id and answer_event['body']['task_id'] == task_id == answer['task_id']
    assert answer_event['body']['request_revision'] == answer['request_revision'] == 1
    assert answer_event['body']['route'] == route and answer_event['body']['text'] == answer['answer']
    assert answer_event['body']['input_source'] == 'phone' and answer_event['body']['raw_action'] is None
    old_request = next(row['item'] for row in before['objects'] if row['item']['kind'] == 'request')
    assert old_request['object_id'] == request_id and old_request['state'] == 'pending'
    assert cloud['task']['object_id'] == task_id and cloud['task']['state'] == 'completed'
    assert cloud['request']['object_id'] == request_id and cloud['request']['state'] == 'answered'
    assert cloud['request']['body']['route'] == route
    assert cloud['request']['answer']['body'] == answer_event['body']
    stages = [receipt['stage'] for receipt in cloud['task']['receipts']]
    assert all(stage in stages for stage in ['agent_received', 'task_resumed', 'task_completed'])
    results = [message for message in cloud['messages'] if message['body']['channel'] == 'result']
    assert len(results) == 1 and results[0]['body']['task_id'] == task_id and results[0]['body']['route'] == route
    result_text = results[0]['body']['text']
    assert 'IO_PHONE_WAIT_OK:' in result_text and answer['answer'] in result_text and answer['nonce'] in result_text
    for name in ['before-task-mailbox.json', 'after-task-mailbox.json']:
        restored = read(COLD / name)
        assert restored['principal'] == after['principal']
        assert {row['operation_id']: (row['payload'], row['state'], row['ack']) for row in restored['outbox']} == {
            row['operation_id']: (row['payload'], row['state'], row['ack']) for row in after['outbox']}
    assert command['command'] in visible_text(EVIDENCE.parent / 'task075-delegate-command-echo.json', 'TextArea')
    assert answer['answer'] in visible_text(EVIDENCE.parent / 'task075-answer-exact-echo.json', 'TextArea')
    review = read(EVIDENCE / 'review-ledger.json')
    assert review['after_cold_start'] and all(review['observed'].values())
    reviews = [text for path in PRIVATE.glob('task075-review-[0-9]*.json') for text in visible_text(path, 'Text')]
    assert any('IO_PHONE_WAIT_OK:' in text and answer['answer'] in text for text in reviews)
    assert '已接受答案：' + answer['answer'] in reviews and '任务已完成' in reviews
    with sqlite3.connect((RUNTIME / 'home/journal.sqlite').as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        operations = db.execute('SELECT * FROM operations').fetchall()
        questions = db.execute('SELECT * FROM questions').fetchall()
        turns = db.execute('SELECT * FROM native_turns').fetchall()
    assert len(operations) == len(questions) == len(turns) == 1
    operation, question, turn = map(dict, [operations[0], questions[0], turns[0]])
    assert operation['state'] == 'completed' and json.loads(operation['source'])['object_id'] == task_id
    assert question['operation_id'] == turn['operation_id'] == operation['operation_id']
    assert question['request_id'] == request_id and question['state'] == 'answered' and question['consumed'] == 1
    assert json.loads(question['answer'])['body'] == answer_event['body']
    native = json.loads(turn['payload'])
    assert turn['state'] == 'returned' and turn['process_closed'] == 1
    assert native['valid'] and native['completed'] and not native['interrupted'] and not native['failed']
    assert answer['answer'] in native['text'] and answer['nonce'] in native['text']
    observed = read(PHASE / (RUNTIME_ID + '-live-observation.json'))
    assert observed['status'] == 'stopped' and observed['bridgeStopped'] and observed['phoneRoleSubmissionsByThisTool'] == 0
    revoked = read(PHASE / ('cloud-' + RUNTIME_ID + '-credentials-revoke.json'))
    assert revoked['status'] == 'revoked' and set(revoked['public_identity_status'].values()) == {401}
    pause = read(EVIDENCE / 'pause-ledger.json')
    assert pause['disabled_confirmed'] and pause['owner_is_this_synthetic_run']
    tests = {}
    for name, count in [('task075-full-app.log', 949), ('task075-targeted-final.log', 27)]:
        text = (PHASE / name).read_text(encoding='utf-8-sig')
        assert f'# tests {count}' in text and f'# pass {count}' in text and '# fail 0' in text
        tests[name] = {'passed': count, 'failed': 0, 'sha256': digest(PHASE / name)}
    report = {'kind': 'normal_phone_cloud_real_hermes_original_task_scenario', 'date': '2026-10-15',
              'version': '0.1.75', 'versionCode': 10075, 'buildRunId': RUN_ID, 'synthetic': True,
              'signedHapSha256': digest(signed), 'signedHapBytes': signed.stat().st_size,
              'realCompileAndOfficialSignatureVerified': True, 'sourceFilesVerified': 778, 'postNativeSourceAuditPassed': True,
              'actualCoverInstall': True, 'normalUiDelegateAndAnswer': True,
              'taskId': task_id, 'requestId': request_id, 'requestRevision': 1,
              'sessionId': route['session_id'], 'routeMatchesEveryStage': True,
              'commandAtUtc': command['at'], 'answerAtUtc': answer['at'],
              'fullConditionAcceptedAndInRealModelResult': True, 'nonceCreatedAfterQuestion': True,
              'taskReceiptStages': stages, 'singleRuntimeOperation': True, 'singleQuestionConsumedOnce': True,
              'realNativeTurnCompletedAndProcessClosed': True, 'fixedCliToolProfile': 'io-question-cli-v1',
              'phoneRoleSubmissionsByPcObserver': 0, 'phoneColdRestartPreservesOriginalOutboxPayloadsAndAcks': True,
              'normalPhoneUiResultAndIndependentReceiptsObservedAfterColdRestart': True,
              'protectedFiles': preservation, 'tests': tests,
              'testConnectionPaused': True, 'testCredentialsRevokedWithPublic401': True,
              'evidenceSha256': {path.name: digest(path) for path in [EVIDENCE / 'mailbox-after-answer.json',
                                   EVIDENCE / 'cloud-readback-private.json', EVIDENCE / 'review-ledger.json']},
              'p43FullAcceptance': False, 'glassesInteractionVerified': False,
              'notVerified': ['formal daily task identity and session enrollment', 'background task network',
                              'normal phone offline/first-answer race/cancel paths', 'live wait crash recovery',
                              'existing user CLI/TUI session adoption', 'glasses two-stage cards and voice',
                              'eight-hour stability/power and official BASE parity']}
    (PHASE / 'task075-native-2026-10-15.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    report = summarize()
    print(json.dumps({'version': report['version'], 'scenarioVerified': True, 'p43FullAcceptance': False,
                      'glassesInteractionVerified': False}))
