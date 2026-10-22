"""Verify current-Codex/physical-phone evidence without publishing session IDs or bearers."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'rebuild/android-app'
RUN = ROOT / 'rebuild/agent-bridge/private/cloud-caller202-20261020-a'
PHONE = BASE / '.private/phone-current-codex-2026-10-20'

def read(file):
    return json.loads(file.read_text(encoding='utf-8'))

def require(value, code):
    if not value:
        raise ValueError(code)

def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def main():
    profile = Path(read(RUN/'active-profile-path.json')['directory']).resolve(strict=True)
    require(profile.is_relative_to((ROOT/'rebuild/agent-bridge/private').resolve()), 'PROFILE_PATH_INVALID')
    context = read(profile/'context.json')
    asked, waited, repeated = (read(RUN/name) for name in ['ask-result.json','wait-result.json','repeat-wait-result.json'])
    expected = (PHONE/'complete-answer.txt').read_text(encoding='utf-8')
    proof, server, revoked = read(PHONE/'context-proof.json'), read(RUN/'server-parent-check.json'), read(ROOT/'rebuild/phase1/cloud-caller202-20261020-a-credentials-revoke.json')
    require(asked['server_stored'] and waited['state']=='answered' and asked['request_id']==waited['request_id'], 'REQUEST_HANDOFF_INVALID')
    answer = waited['answer']['body']
    require(answer['text']==expected and answer['request_id']==asked['request_id'] and answer['request_revision']==1 and answer['task_id']==context['task_id'] and answer['route']==context['route'], 'ORIGINAL_CALLER_ANSWER_MISMATCH')
    require(proof['current_environment_matches'] and proof['current_app_inventory_matches'] and not proof['new_codex_session_created'], 'CURRENT_CALLER_NOT_PROVEN')
    require(repeated['answer']==waited['answer'] and repeated['already_delivered'] and not repeated['network_checked'], 'RETRY_NOT_IDEMPOTENT')
    require(server['complete_answer_matches'] and server['task_resumed_receipts']==1 and server['request_revision']==1 and server['original_context_route_matches'], 'SERVER_FACTS_INVALID')
    require(revoked['status']=='revoked' and all(v==401 for v in revoked['public_identity_status'].values()), 'CREDENTIAL_CLEANUP_NOT_CONFIRMED')
    require(read(PHONE/'paused.json')['temporary_connection_paused'], 'PHONE_NOT_PAUSED')
    db=sqlite3.connect((profile/'journal.sqlite').as_uri()+'?mode=ro',uri=True)
    try:
        operations=db.execute('select state,count(*) from operations group by state').fetchall()
        questions=db.execute('select request_id,state,consumed from questions').fetchall()
        turns=db.execute('select count(*) from native_turns').fetchone()[0]
        events=[json.loads(row[0]) for row in db.execute('select event from runtime_events')]
    finally:db.close()
    require(operations==[('claimed',1)] and questions==[(asked['request_id'],'answered',1)] and turns==0, 'CALLER_JOURNAL_FACTS_INVALID')
    require(sum(action.get('stage')=='task_resumed' for event in events for action in event['actions'])==1, 'DUPLICATE_RESUMPTION')
    source=ROOT/'rebuild/agent-bridge/skill/turboio-ask-user/SKILL.md'
    installed=Path('C:/Users/LENOVO/.codex/skills/turboio-ask-user/SKILL.md')
    require(sha(source)==sha(installed),'INSTALLED_SKILL_SOURCE_MISMATCH')
    files=['questions/cli.mjs','questions/context.py','questions/tool.py','questions/adapter.py','questions/test_questions.py','questions/tests/cli.test.mjs','skill/turboio-ask-user/SKILL.md']
    report={'schema':1,'at':datetime.now(timezone.utc).isoformat(),'scope':'Current Codex personally calls CLI, public HTTPS, normal physical Android answer form; known synthetic answer entered by agent',
        'current_codex_context_verified_against_app':True,'context_sha256':proof['context_sha256'],'new_codex_session_created':False,'model_or_codex_process_launched':False,
        'physical_phone':True,'real_server':True,'real_current_codex':True,'physical_glasses_in_this_loop':False,'human_answered':False,
        'checks':{'original_request_revision_route_match':True,'complete_multiline_answer_exact':True,'original_cli_wait_received_answer':True,
            'one_answer_consumption':True,'one_task_resumed_receipt':True,'repeated_wait_same_answer_without_network':True,'installed_skill_hash_matches':True,
            'temporary_phone_connection_paused':True,'credentials_revoked_public_401':True},
        'tests':{'python_tests':9,'actual_cli_bridge_server_integration_scenarios':1,'scope':['caller mismatch','rerouting rejected','original question/revision','duplicate wait','offline pending intent retained','offline delivered answer reread','parent closed prevents resumption','pending registration switch denied','readonly offline status']},
        'answer_utf8_bytes':len(expected.encode('utf-8')),'answer_sha256':hashlib.sha256(expected.encode('utf-8')).hexdigest(),
        'sources':[{ 'path':file,'sha256':sha(ROOT/'rebuild/agent-bridge'/file)} for file in files],
        'official_skills_reference':'https://learn.chatgpt.com/docs/build-skills',
        'context_environment_boundary':'CODEX_THREAD_ID observed in this desktop build and checked against app inventory; missing/mismatched identity fails closed',
        'credential_cleanup':revoked['public_identity_status'],'scope_excludes':['real user decision','glasses selection or full oral supplement','automatic multi-agent route registration on phone','formal persistent credentials/renewal','background and 8-hour wear'],
        'full_P4_exit_passed':False,'overall_release_gate_passed':False}
    (BASE/'current-codex-text-2026-10-20.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'current_codex_phone_text_loop':'passed','answer_consumptions':1,'task_resumed_receipts':1,'new_session_created':False,'glasses_acceptance':False}))

if __name__=='__main__':main()
