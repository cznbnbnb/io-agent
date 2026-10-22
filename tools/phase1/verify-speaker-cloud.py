"""Explicit public HTTPS smoke test with an exclusive synthetic owner.

Never reads user materials or reuses user credentials. The existing credential
issuer transports secrets through captured SSH stdout to ACL-protected files;
tokens never enter command arguments, logs, reports or the repository.
"""
import argparse
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import uuid
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
BASE = 'https://cznbnb.cn/io-api/v1/'
ROLES = {'writer': ['materials:write', 'materials:read', 'changes:read'],
         'reader': ['materials:read', 'changes:read']}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('CLOUD_REDIRECT_REFUSED')


def require(value, code):
    if not value:
        raise ValueError(code)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--run-cloud', action='store_true')
    args = parser.parse_args()
    require(args.run_cloud and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}', args.run_id),
            'EXPLICIT_SYNTHETIC_CLOUD_TEST_REQUIRED')
    spec = importlib.util.spec_from_file_location('cloud_credentials', TOOLS / 'cloud-test-credentials.py')
    issuer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(issuer)
    issuer.ROLES = ROLES  # Only this exclusive verification owner's two roles.
    directory = ROOT / ('rebuild/agent-bridge/private/cloud-' + args.run_id)
    directory.mkdir(parents=True, exist_ok=False)
    issuer.protect_directory(directory)
    report = {'at': datetime.now(timezone.utc).isoformat(), 'run_id': args.run_id,
              'status': 'failed', 'scope': 'real public HTTPS and actual query CLI; exclusive synthetic owner; no physical phone/glasses/model',
              'checks': [], 'roles': ROLES, 'credential_ttl_ms': 3600000,
              'user_owner_data_touched': False,
              'not_verified': ['physical phone speaker correction and upload', 'real speaker identity/accuracy', 'original audio archive or playback', 'eight-hour stability']}
    connection = None
    issue_started = False
    opener = build_opener(ProxyHandler({}), HTTPSHandler(), NoRedirect())
    credentials = {}

    def call(role, route, body=None):
        require(re.fullmatch(r'(identity|material-events|materials/[A-Za-z0-9_-]+(?:\?revision=\d+)?)', route), 'CLOUD_ROUTE_INVALID')
        token = credentials[role]['token']
        require(re.fullmatch(r'[A-Za-z0-9_-]{43}', token), 'CLOUD_CREDENTIAL_INVALID')
        request = Request(BASE + route, method='GET' if body is None else 'POST',
                          data=None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8'),
                          headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
                                   **({} if body is None else {'Content-Type': 'application/json'})})
        try:
            response = opener.open(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            data = response.read(1048577)
            require(len(data) <= 1048576, 'CLOUD_RESPONSE_TOO_LARGE')
            return response.status, json.loads(data.decode('utf-8'))

    def check(value, label):
        require(value, label)
        report['checks'].append(label)

    try:
        manifest = json.loads((ROOT / 'rebuild/phase1/io-server-20261013-r3-manifest.json').read_text(encoding='utf-8'))
        report.update(release_id=manifest['release_id'], archive_sha256=manifest['archive_sha256'], source_git_commit=manifest['source_git_commit'])
        connection = issuer.publisher.connect()
        issue_started = True
        issued = issuer.remote(connection, 'issue', args.run_id)
        require(issued['owner_id'] == 'synthetic-cloud-' + args.run_id and set(issued['credentials']) == set(ROLES), 'CLOUD_CREDENTIAL_BINDING_MISMATCH')
        credentials = issued['credentials']
        report['credential_expiry'] = {role: value['expires_at'] for role, value in credentials.items()}
        for role, credential in credentials.items():
            issuer.write_new(directory / (role + '.json'), credential)
        config = {'schema_version': '1.0', 'base_url': BASE, 'owner_id': issued['owner_id'],
                  'producer_id': 'cloud-reader', 'server_id': issued['server_id'],
                  'credential_file': 'reader.json', 'timeout_ms': 10000}
        issuer.write_new(directory / 'query-config.json', config)
        for role in ROLES:
            status, identity = call(role, 'identity')
            check(status == 200 and identity['owner_id'] == issued['owner_id'] and identity['producer_id'] == 'cloud-' + role
                  and identity['server_id'] == issued['server_id'] and identity['material_schema_versions'] == ['1.0', '1.1', '1.2'],
                  'PUBLIC_' + role.upper() + '_IDENTITY_ADVERTISES_1_2')
        material_id = 'synthetic-r3-' + args.run_id
        examples = json.loads((ROOT / 'docs/contracts/material-v1.2.json').read_text(encoding='utf-8'))['events']
        original_id = examples[0]['body']['material_id']
        events = json.loads(json.dumps(examples, ensure_ascii=False).replace(original_id, material_id))
        now = datetime.now(timezone.utc)
        for event in events:
            event.update(event_id=str(uuid.uuid4()), idempotency_key=str(uuid.uuid4()), producer_id='cloud-writer',
                         created_at=now.isoformat(), expires_at=(now + timedelta(hours=1)).isoformat())
        acknowledgements = []
        for event in events:
            status, acknowledgement = call('writer', 'material-events', event)
            check(status == 201, 'PUBLIC_SPEAKER_REVISION_' + str(event['body']['revision']) + '_STORED')
            acknowledgements.append(acknowledgement)
        status, replay = call('writer', 'material-events', events[-1])
        check(status == 200 and replay == acknowledgements[-1], 'PUBLIC_IDENTICAL_SPLIT_REPLAY_RETURNS_ORIGINAL_RECEIPT')
        missing = copy.deepcopy(events[-1])
        missing.update(event_id=str(uuid.uuid4()), idempotency_key=str(uuid.uuid4()))
        missing['body'].update(revision=5, base_revision=4)
        missing['body']['audio']['state'] = 'missing'
        status, missing_ack = call('writer', 'material-events', missing)
        check(status == 201, 'PUBLIC_SPLIT_MISSING_AUDIO_METADATA_STORED')
        corrected = copy.deepcopy(missing)
        corrected.update(event_id=str(uuid.uuid4()), idempotency_key=str(uuid.uuid4()))
        corrected['body'].update(revision=6, base_revision=5, text_revision=5)
        corrected['body']['utterances'][0]['text'] = '合成上线测试：人工更正，原音当前不可用。'
        corrected['body']['full_text'].update(origin='user', text='\n'.join(u['text'] for u in corrected['body']['utterances']))
        status, corrected_ack = call('writer', 'material-events', corrected)
        check(status == 201, 'PUBLIC_MISSING_AUDIO_TEXT_CORRECTION_STORED')
        status, latest = call('reader', 'materials/' + material_id)
        check(status == 200 and latest['schema_version'] == '1.2' and latest['body'] == corrected['body'],
              'PUBLIC_LATEST_READ_RETAINS_EXACT_DICTIONARY_TEXT_AND_PARENT_RANGE')

        def cli(*arguments):
            result = subprocess.run(['D:/openclaw/nodejs/node.exe', str(ROOT / 'rebuild/material-server/query/cli.mjs'),
                                     *arguments, '--config', str(directory / 'query-config.json')],
                                    capture_output=True, timeout=25, creationflags=subprocess.CREATE_NO_WINDOW)
            require(result.returncode == 0 and len(result.stdout) <= 1048576, 'PUBLIC_QUERY_CLI_FAILED')
            return json.loads(result.stdout)

        queried = cli('get', '--material-id', material_id)
        item = queried['items'][0]
        child = next(match for match in item['matches'] if match['kind'] == 'utterance')
        check(item['body'] == corrected['body'] and child['source_ref']['parent_source_ref']['revision'] == 3
              and child['source_ref']['source_range'] == corrected['body']['utterances'][0]['source_range']
              and item['body']['utterances'][0]['start_ms'] is None and item['body']['utterances'][0]['end_ms'] is None
              and item['evidence']['audio_playback_available'] is False,
              'PUBLIC_ACTUAL_CLI_PRESERVES_UNKNOWN_CHILD_TIME_AND_IMMUTABLE_PARENT_CITATION')
        original = cli('get', '--material-id', material_id, '--revision', '3')['items'][0]
        check(original['body'] == events[2]['body'], 'PUBLIC_ACTUAL_CLI_ORIGINAL_REVISION_UNCHANGED')
        speaker = corrected['body']['speakers'][0]['speaker_id']
        found = cli('search', '--speaker', speaker)
        check([item['body']['material_id'] for item in found['items']] == [material_id],
              'PUBLIC_ACTUAL_CLI_SPEAKER_ID_SEARCH_IS_MATERIAL_SCOPED')
        changes = cli('changes')
        check([item['body']['revision'] for item in changes['items']] == [1, 2, 3, 4, 5, 6],
              'PUBLIC_ACTUAL_CLI_CHANGES_RETAINS_EACH_IMMUTABLE_REVISION')
        denied_status, denied = call('reader', 'material-events', corrected)
        check(denied_status == 403 and denied['error']['code'] == 'FORBIDDEN', 'PUBLIC_READ_ONLY_CREDENTIAL_CANNOT_WRITE')
        report.update(status='passed', material_id=material_id, highest_revision=6, server_id=issued['server_id'])
    except Exception as error:
        code = str(error)
        report['error'] = code if re.fullmatch(r'[A-Z_0-9]{3,100}', code) else type(error).__name__
    finally:
        if connection:
            connection.close()
        if issue_started:
            try:
                connection = issuer.publisher.connect()
                revoked = issuer.remote(connection, 'revoke', args.run_id)
                require(set(revoked['revoked_roles']) == set(ROLES), 'CLOUD_REVOCATION_INCOMPLETE')
                report['credentials_revoked'] = True
                if credentials:
                    for role in credentials:
                        status, _ = call(role, 'identity')
                        check(status == 401, 'PUBLIC_' + role.upper() + '_REVOCATION_ENFORCED')
            except Exception as error:
                report.update(status='failed', credentials_revoked=False, revocation_error=type(error).__name__)
            finally:
                if connection:
                    connection.close()
        target = ROOT / ('rebuild/phase1/cloud-' + args.run_id + '-speaker-verification.json')
        issuer.write_new(target, report)
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']),
                      'credentials_revoked': report.get('credentials_revoked', False), 'error': report.get('error')}))
    return 0 if report['status'] == 'passed' and report.get('credentials_revoked') else 1


if __name__ == '__main__':
    raise SystemExit(main())
