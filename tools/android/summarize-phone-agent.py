"""Read-only physical-phone/real-provider evidence, with no bearer or source body output."""
import hashlib
import json
from pathlib import Path
import sqlite3
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
RUN_ID = 'phone201-20261020-a'
BASE = ROOT / 'rebuild/android-app'
EVIDENCE = BASE / '.private/phone-minute-card-2026-10-20'
RUN = ROOT / 'rebuild/agent-bridge/private' / ('phone-' + RUN_ID)

def read(file):
    return json.loads(file.read_text(encoding='utf-8'))

def require(value, code):
    if not value:
        raise ValueError(code)

def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def main():
    candidate = read(BASE / 'candidate.json')
    expected = (EVIDENCE / 'p3-complete-answer.txt').read_text(encoding='utf-8')
    ui = read(EVIDENCE / 'p3-original-task-result-ui.json')
    restarted = read(EVIDENCE / 'p3-restart-result-ui.json')
    require(ui['exact_complete_answer'] and ui['result'].startswith('ANDROID_P3_ANSWER_OK:') and ui['result'].endswith(expected), 'FULL_PHONE_RESULT_NOT_VERIFIED')
    require(restarted['exact_complete_answer'] and restarted['saved_connection_loaded'], 'RESTART_NOT_VERIFIED')
    first = read(EVIDENCE / 'p3-full-ui.json')
    require('ANDROID_P3_OK\nFull answer: 17 + 25 = 42.' in first['texts'] and '已完成' in first['texts'], 'FIRST_TASK_NOT_COMPLETED')
    db = sqlite3.connect((RUN / 'home/journal.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        operations = db.execute('select operation_id,source,state from operations').fetchall()
        questions = db.execute('select operation_id,request_id,state,answer,consumed from questions').fetchall()
        turns = db.execute('select state,process_closed from native_turns').fetchall()
        unacked = db.execute('select count(*) from runtime_events where acked!=1').fetchone()[0]
    finally:
        db.close()
    require(len(operations) == 2 and all(row[2] == 'completed' for row in operations), 'ORIGINAL_TASKS_NOT_COMPLETED')
    require(len(turns) == 2 and all(state == 'returned' and closed == 1 for state, closed in turns), 'NATIVE_TURNS_NOT_CLOSED')
    require(len(questions) == 1 and questions[0][2] == 'answered' and questions[0][4] == 1, 'ORIGINAL_QUESTION_NOT_CONSUMED_ONCE')
    operation, request, _, answer, _ = questions[0]
    body = json.loads(answer)['body']
    source = json.loads(next(row[1] for row in operations if row[0] == operation))
    require(body['text'] == expected and body['request_id'] == request and body['request_revision'] == 1, 'FULL_ANSWER_BINDING_INVALID')
    require(body['task_id'] == source['object_id'] and body['route'] == source['body']['route'], 'ORIGINAL_TASK_ROUTE_INVALID')
    require(unacked == 0, 'RUNTIME_EVENTS_NOT_ACKED')
    state = read(RUN / 'home/bridge-state.json')
    require(not state['outbox'] and not state['dispatches'], 'BRIDGE_HAS_UNSETTLED_WORK')
    report = {'schema': 1, 'at': datetime.now(timezone.utc).isoformat(), 'version': candidate['version'], 'apk_sha256': candidate['sha256'],
        'scope': 'physical Android normal UI, public HTTPS queue, real isolated Hermes provider; synthetic task/question/answer, no physical lens acceptance',
        'physical_phone': True, 'real_server': True, 'real_hermes': True, 'real_current_codex': False, 'run_id': RUN_ID,
        'checks': {'normal_ui_identity_enable_save': True, 'physical_phone_text_task': True, 'complete_two_line_result': True,
            'real_original_task_question': True, 'phone_complete_answer_exact': True, 'original_question_and_route_bound': True,
            'original_task_resumed_and_completed': True, 'app_restart_preserves_connection_and_result': True,
            'exactly_two_native_turns_for_two_tasks_after_restart': True, 'original_answer_consumed_once': True,
            'bridge_outbox_and_dispatches_settled': True, 'runtime_events_acknowledged': True},
        'counts': {'completed_operations': 2, 'native_turns_closed': 2, 'questions': 1, 'consumed_answers': 1},
        'answer_utf8_bytes': len(expected.encode('utf-8')), 'answer_sha256': digest(expected), 'result_sha256': digest(ui['result']),
        'phone_answer_entered_by': 'agent accessibility input on normal physical phone form, explicitly synthetic text; not a human answer',
        'evidence_directory': str(EVIDENCE.relative_to(BASE)), 'credentials_cleanup': 'pending_closeout',
        'not_verified': ['current Codex conversation ask/wait/status', 'glasses task integration or full voice', 'physical network interruption during submission',
            'production identity/long-term credential renewal', 'Redmi background/lockscreen scheduling and 8-hour wear', 'materials'],
        'full_P3_exit_passed': False, 'overall_release_gate_passed': False}
    (BASE / 'phone-agent-text-2026-10-20.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'physical_phone_real_hermes_text_loop': 'passed', 'tasks': 2, 'original_question_answers': 1, 'restart_no_duplicate': True}))

if __name__ == '__main__':
    main()
