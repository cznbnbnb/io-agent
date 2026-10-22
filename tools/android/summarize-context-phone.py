"""Reconcile independent UI, Keystore, server, signing and source records; emit no credentials."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json
ROOT=Path(__file__).resolve().parents[2]
APP=ROOT/'rebuild/android-app'
PHONE=APP/'.private/phone-multicontext-2026-10-20'
RUN=ROOT/'rebuild/agent-bridge/private/cloud-contexts203-20261020-a'
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def require(ok,code):
 if not ok:raise ValueError(code)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
candidate=read(APP/'candidate.json');installed=read(PHONE/'installation.json');ui=read(PHONE/'normal-ui-dev2.json');final=read(PHONE/'final-ui.json')
require(candidate['version']=='0.5.0-dev2' and candidate['sha256']==installed['installed_sha256'] and installed['to']==candidate['version'],'INSTALLED_CANDIDATE_MISMATCH')
require(candidate['signature_v2'] and candidate['signature_v3'] and candidate['signer_sha256']=='174695b5352ddb1af105a5ef604caf7a8332a52986af8d8eb642e2d3c91ff7ad','SIGNATURE_IDENTITY_MISMATCH')
require(all(v is True for k,v in ui.items() if k!='schema'),'NORMAL_UI_NOT_VERIFIED')
require(final['registered_count']==4 and final['complete_test_answers']==3 and final['dev2_keystore_checks']==12 and all(final[k] is True for k in ['all_profiles_paused_before_restart','selected_paused_before_restart','restart_registered_count_preserved','restart_selected_pause_preserved','restart_complete_test_answers_preserved']),'FINAL_PHONE_STATE_UNVERIFIED')
probe=(PHONE/'keystore-probe-dev2.txt').read_text(encoding='utf-8')
require('checks_passed=12' in probe and 'INSTRUMENTATION_CODE: -1' in probe and 'real_task_preferences_touched=false' in probe and 'test_namespace_removed=true' in probe,'KEYSTORE_CHECKS_UNVERIFIED')
plan=read(RUN/'context-check.json');objects=read(RUN/'context-server-objects.json');closed=read(RUN/'context-closed.json');answer_ids=set()
for index,context in enumerate(plan['contexts']):
 key=context['key'];imported=read(PHONE/f'import-{key}.json');entered=read(PHONE/f'answer-{key}.json')
 require(imported['registered_count']==index+2 and all(imported[k] is True for k in ['normal_ui_import','identity_preflight','enabled_explicitly','prior_profiles_retained','delivered_file_removed']),'NORMAL_IMPORT_NOT_VERIFIED')
 require(all(entered[k] is True for k in ['normal_question_page','exact_question_selected','complete_known_multiline_answer','entered_by_agent','submitted_via_product_ui']) and entered['human_decision'] is False,'NORMAL_ANSWER_NOT_VERIFIED')
 request=next(v for v in objects if v['object_id']==context['request_id']);answer=request['answer']['body']
 require(request['state']=='answered' and answer['request_id']==context['request_id'] and answer['request_revision']==1 and answer['task_id']==context['task_id'] and answer['route']==context['route'] and answer['text']==context['answer'] and answer['input_source']=='phone','ORIGINAL_COMPLETE_ANSWER_MISMATCH')
 answer_ids.add(answer['answer_id'])
require(len(answer_ids)==3 and len(closed)==3 and all(v['state']=='cancelled' for v in closed),'TEST_TASKS_NOT_CLOSED')
revoked=read(ROOT/'rebuild/phase1/cloud-contexts203-20261020-a-credentials-revoke.json')
require(revoked['status']=='revoked' and revoked['remote_revoked'] and revoked['public_identity_status']=={'phone':401,'agent':401,'operations':401},'CREDENTIALS_NOT_REVOKED')
sources=read(APP/'candidate-source.json')['sources'];required={'TaskConnection.java','TaskProfiles.java','TaskHub.java','TaskSettings.java','TaskRuntime.java','TaskWorkspace.java','TaskConnectionUI.java','TaskMailbox.java'};checked=[]
for row in sources:
 if Path(row['path']).name in required:
  require(sha(APP/row['path'])==row['sha256'],'SOURCE_CHANGED_AFTER_BUILD');checked.append(row)
require(len(checked)==len(required),'SOURCE_PROVENANCE_MISSING')
tests=read(APP/'context-test-results.json');require('41 checks passed' in tests['checks'],'CONTEXT_TESTS_NOT_VERIFIED')
cleanup=read(PHONE/'driver-cleanup.json');require(cleanup['driver_uninstalled'] and cleanup['official_home_visible'],'PHONE_CLEANUP_UNVERIFIED')
report={'schema':1,'at':datetime.now(timezone.utc).isoformat(),'candidate':candidate['version'],'version_code':candidate['version_code'],'installed':True,'sha256':candidate['sha256'],'kind':'Physical Redmi normal UI + public HTTPS synthetic contexts; real Keystore; no model/Agent/lens/voice acceptance',
 'checks':{'registered_three_synthetic_routes_plus_prior_history':True,'original_complete_answers_request_revision_task_route_match':True,'answering_nondefault_targets_keeps_original_route':True,'legacy_full_answer_visible_and_retained':True,'restart_preserves_four_profiles_and_three_complete_answers':True,'all_profiles_paused':True,'keystore_migration_pause_restart_tamper_checks':12,'jvm_context_checks':41,'synthetic_tasks_closed':3,'all_test_credentials_revoked_public_401':True,'diagnostic_driver_removed':True},
 'source_provenance':checked,'official_voice_interface_evidence':'official-voice-107-interfaces.json','home_preview_evidence':'phone-home-preview-2026-10-20.json',
 'history':['Initial test-source lambda captures corrected before passing.','dev1 UI hid stored answers and overview was misleading; dev2 merged both fixes.','Initial Hermes automation swipe skipped its card; retry used smaller swipes and answered the same original request.','Initial credential issuance was rejected by auto-review; direct user authorization was obtained before successful issuance.'],
 'limits':['Actual current Codex/Hermes runtime text checks remain separate prior evidence.','Dedicated daily Q&A runtime, automatic new-context discovery/retirement and formal credentials still need work.','Real request-bound glasses cards and full voice are not integrated.','A20-G01 temporary head-gesture disable/restore must precede actionable Agent cards.','Phone background/network fault and 8-hour maturity gates remain.','Weather A20-W01 remains open; homepage preview coverage needs verification.'],
 'minute_card_baseline':'Prior 0.4.5-dev1 user-accepted milestone unchanged; no repeat lens test in this batch', 'release_gate_passed':False}
(APP/'phone-multicontext-2026-10-20.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'physical_phone_three_synthetic_contexts':'passed','complete_answers':3,'profiles_retained':4,'keystore_checks':12,'credentials_revoked_public_401':True,'full_P4_or_release_claimed':False}))
