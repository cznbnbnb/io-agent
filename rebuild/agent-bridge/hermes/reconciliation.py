"""Offline administrative reconciliation; never exposed as a model tool.

Native evidence is checked, operator attestations are labelled as such. Neither
method resends a task. An operator decision is not a native completion proof.
"""
import hashlib
import json
from pathlib import Path
import re
import stat

from managed_home import ManagedHomeLease
from native_observer import classify
from pinned_runtime import verify_source
from runtime_environment import require_enrollment_ready
from runtime_journal import RuntimeJournal, RuntimeJournalError, encode

CONFIRMATION = 'I_VERIFIED_ORIGINAL_TASK_OUTCOME_AND_WILL_NOT_REPLAY'


def digest(value):
    return hashlib.sha256(encode(value).encode('utf-8')).hexdigest()


def validate_config(config):
    if not isinstance(config, dict) or set(config) != {'home','journal','binding','sessions','source','site_packages'}:
        raise RuntimeJournalError('RUNTIME_CONFIG_INVALID')
    home, journal = Path(config['home']), Path(config['journal'])
    if (not home.is_absolute() or not journal.is_absolute() or home.is_symlink()
            or journal.is_symlink() or not journal.is_file()
            or journal.parent.resolve(strict=True) != home.resolve(strict=True)):
        raise RuntimeJournalError('RUNTIME_REVIEW_PATH_INVALID')
    return home


def inspect(config, operation_id):
    # No lease, SDK bootstrap, provider access, migration or file creation.
    validate_config(config)
    journal = RuntimeJournal.open_readonly(config['journal'], config['binding'])
    try:
        snapshot = journal.review_snapshot(operation_id)
        operation, native = snapshot['operation'], snapshot['native']
        source = json.loads(operation['source'])
        flags = (native or {}).get('payload') or {}
        text = flags.get('text')
        return {'schema':1, 'operation_id':operation_id,
                'task_id':source['body']['task_id'], 'route':source['body']['route'],
                'state':operation['state'], 'review_digest':digest(snapshot),
                'cancel_requested':snapshot['cancel_requested'],
                'native':None if native is None else {
                    'state':native['state'], 'process_closed':native['process_closed']==1,
                    'flags':{key:flags.get(key) for key in
                        ['valid','completed','failed','partial','interrupted','user_intervened',
                         'error_present','cleanup_error_present','exception_observed']},
                    'result_present':isinstance(text,str),
                    'result_sha256':hashlib.sha256(text.encode('utf-8')).hexdigest() if isinstance(text,str) else None},
                'questions':[{'request_id':row['request_id'], 'state':row['state'],
                              'answer_present':row['answer'] is not None,
                              'consumed':bool(row['consumed'])} for row in snapshot['questions']],
                'outcome_method':(json.loads(operation['outcome']) if operation['outcome'] else {}).get('reconciliation',{}).get('method'),
                'cloud_delivery_verified':False, 'replay_permitted':False}
    finally:
        journal.close()


def validate_decision(decision):
    base={'schema','operation_id','review_digest','resolution_id','method'}
    if not isinstance(decision,dict) or decision.get('method') not in {'native_evidence','operator_attestation'}:
        raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')
    required=base if decision['method']=='native_evidence' else base | {
        'actor','decision','reason','evidence_file','evidence_sha256','result_text','confirmation',
        'owned_processes_stopped','external_effects_reviewed'}
    if set(decision)!=required or type(decision['schema']) is not int or decision['schema']!=1:
        raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')
    for key in ['operation_id','resolution_id']:
        if not isinstance(decision[key],str) or not re.fullmatch('[A-Za-z0-9_.:-]{1,128}',decision[key]):
            raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')
    if not isinstance(decision['review_digest'],str) or not re.fullmatch('[0-9a-f]{64}',decision['review_digest']):
        raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')
    if decision['method']=='operator_attestation':
        if (decision['confirmation']!=CONFIRMATION or decision['decision'] not in {'completed','failed','cancelled'}
                or decision['owned_processes_stopped'] is not True or decision['external_effects_reviewed'] is not True
                or not isinstance(decision['actor'],str) or not decision['actor'].strip() or len(decision['actor'])>128
                or not isinstance(decision['reason'],str) or not decision['reason'].strip() or len(decision['reason'])>2048
                or not isinstance(decision['evidence_file'],str) or not Path(decision['evidence_file']).is_absolute()
                or not isinstance(decision['evidence_sha256'],str) or not re.fullmatch('[0-9a-f]{64}',decision['evidence_sha256'])):
            raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')
        text=decision['result_text']
        if ((decision['decision']=='completed' and (not isinstance(text,str) or not text.strip() or len(text)>65536))
                or (decision['decision']!='completed' and text is not None)):
            raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')


def apply(config, decision):
    validate_decision(decision)
    home=validate_config(config)
    verify_source(config['source'])
    require_enrollment_ready(home,config['sessions'])
    # Live owner excludes the administrator. Never delete/steal an ownership
    # file or kill a process to obtain this lease.
    lease=ManagedHomeLease(home,config['binding'],config['sessions'])
    journal=None
    try:
        lease.assert_held()
        journal=RuntimeJournal(config['journal'],config['binding'])
        snapshot=journal.review_snapshot(decision['operation_id'])
        operation=snapshot['operation']
        source=json.loads(operation['source'])
        route=source['body']['route']
        registration=config['sessions'].get(route['session_id'])
        if (registration is None or registration['project_id']!=route['project_id']
                or route['computer_id']!=config['binding']['computer_id']
                or route['agent_id']!=config['binding']['agent_id']):
            raise RuntimeJournalError('RUNTIME_SESSION_UNREGISTERED')
        original_outcome=json.loads(operation['outcome']) if operation['outcome'] else {}
        prior=original_outcome.get('reconciliation')
        decision_digest=digest(decision)
        if prior is not None and prior.get('decision_digest')!=decision_digest:
            raise RuntimeJournalError('RUNTIME_RECONCILIATION_CONFLICT')
        if decision['method']=='native_evidence':
            state=classify(snapshot['native'])
            if state not in {'completed','failed'}:
                raise RuntimeJournalError('RUNTIME_NATIVE_EVIDENCE_INSUFFICIENT')
            text=snapshot['native']['payload'].get('text') if state=='completed' else None
            audit={'method':'native_evidence'}
        else:
            file=Path(decision['evidence_file'])
            info=file.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or not 0<info.st_size<=16777216:
                raise RuntimeJournalError('RUNTIME_REVIEW_EVIDENCE_UNSAFE')
            sha=hashlib.sha256(file.read_bytes()).hexdigest()
            if sha!=decision['evidence_sha256']:
                raise RuntimeJournalError('RUNTIME_REVIEW_EVIDENCE_CHANGED')
            state,text=decision['decision'],decision['result_text']
            audit={'method':'operator_attestation','actor':decision['actor'],
                   'reason':decision['reason'],'evidence_sha256':sha,
                   'owned_processes_stopped':True,'external_effects_reviewed':True,
                   'native_completion_proven':False}
        audit.update(resolution_id=decision['resolution_id'],decision_digest=decision_digest,
                     review_digest=decision['review_digest'])
        suffix=digest([operation['operation_id'],decision['resolution_id']])
        actions=[{'action':'task_state','state':state},
                 {'action':'receipt','stage':'task_completed' if state=='completed' else state,
                  'subject_kind':'task','subject_id':source['body']['task_id'],
                  'subject_revision':source['revision']}]
        if text is not None:
            if decision['method']=='operator_attestation':
                actions.append({'action':'message','channel':'progress','message_id':'review-'+suffix,
                                'text':'任务结果经人工对账确认，未重新执行原任务。'})
            actions.append({'action':'message','channel':'result','message_id':'result-'+suffix,'text':text})
        event={'event_id':'reconcile-'+suffix,'delivery_id':operation['delivery_id'],'actions':actions}
        lease.assert_held()
        changed=journal.reconcile_unknown(operation['operation_id'],decision['review_digest'],state,audit,event)
        return {'schema':1,'status':'reconciled' if changed else 'already_reconciled',
                'operation_id':operation['operation_id'],'state':state,'method':decision['method'],
                'cloud_delivery_verified':False,'replayed':False}
    finally:
        if journal:
            journal.close()
        lease.close()
