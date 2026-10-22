"""Read-only sanitized diagnostics for one explicitly selected isolated run."""
import json
from pathlib import Path
import sqlite3
import sys

root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'rebuild/agent-bridge/hermes'))
from runtime_journal import timestamp

run=Path(sys.argv[1]).resolve(strict=True)
private=(root/'rebuild/agent-bridge/private').resolve(strict=True)
if not run.is_relative_to(private):raise SystemExit('PRIVATE_TEST_RUN_REQUIRED')
with sqlite3.connect((run/'queue.sqlite').as_uri()+'?mode=ro',uri=True) as db:
    db.row_factory=sqlite3.Row
    req=db.execute("SELECT * FROM queue_revisions WHERE kind='request' LIMIT 1").fetchone()
    answer=db.execute("SELECT * FROM queue_revisions WHERE kind='answer' LIMIT 1").fetchone()
    messages=db.execute("SELECT body FROM queue_revisions WHERE kind='message'").fetchall()
with sqlite3.connect((run/'home/journal.sqlite').as_uri()+'?mode=ro',uri=True) as db:
    spec=db.execute('SELECT spec FROM questions LIMIT 1').fetchone()
if req and answer and spec:
    r=json.loads(req['body']);a=json.loads(answer['body']);s=json.loads(spec[0])
    print(json.dumps({'request_revision':req['revision'],'request_kind':req['kind'],
        'answer_revision':answer['revision'],'routes_equal':r['route']==a['route'],
        'runtime_id_matches':r.get('runtime_request_id')==s['runtime_request_id'],
        **{name+'_matches':r.get(name)==s[name] for name in ['question','mode','options']},
        'stored_before_question_deadline':timestamp(answer['stored_at'])<timestamp(s['expires_at']),
        'deadline_minus_answer_seconds':timestamp(s['expires_at'])-timestamp(answer['stored_at']),
        'result_checks':[{'task_id':body.get('task_id'),
            'contains_actual_answer':a['text'] in body.get('text',''),
            'contains_result_marker':'IO_REAL_WAIT_OK:' in body.get('text',''),
            'contains_exact_concatenation':'IO_REAL_WAIT_OK:'+a['text'] in body.get('text',''),
            'contains_second_marker':'IO_REAL_SECOND_OK' in body.get('text','')}
            for body in [json.loads(row[0]) for row in messages]]}))
else:print(json.dumps({'request_present':bool(req),'answer_present':bool(answer),'local_question_present':bool(spec)}))
