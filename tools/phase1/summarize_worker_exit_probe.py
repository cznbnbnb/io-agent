"""Publish only metadata from an isolated native-Worker timeout probe."""
import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summarize(report, ledger, log, original, copy):
    if report.get('kind') != 'p22_native_exit_probe' or report.get('schema') != 1:
        raise ValueError('Unexpected probe format')
    events = report['events']
    permitted = {'created', 'waiting_exit', 'terminate_requested', 'terminate_request_failed',
                 'exit_confirmed', 'closed_without_worker'}
    if not isinstance(events, list) or len(events) > 40:
        raise ValueError('Unexpected lifecycle events')
    safe = []
    for event in events:
        if event['state'] not in permitted or any(type(event[k]) is not int for k in ('clientId', 'at', 'exitCode')):
            raise ValueError('Unexpected lifecycle event')
        safe.append({k: event[k] for k in ('clientId', 'state', 'at', 'exitCode')})
    first = next(e for e in safe if e['state'] == 'created')
    closing = next(e for e in safe if e['clientId'] == first['clientId'] and e['state'] == 'terminate_requested')
    exit_event = next(e for e in safe if e['clientId'] == first['clientId'] and e['state'] == 'exit_confirmed')
    waiting = next(e for e in safe if e['clientId'] != first['clientId'] and e['state'] == 'waiting_exit')
    replacement = next(e for e in safe if e['clientId'] == waiting['clientId'] and e['state'] == 'created')
    ordered = (safe.index(closing) < safe.index(waiting) < safe.index(exit_event) < safe.index(replacement)
               and closing['at'] <= waiting['at'] <= exit_event['at'] <= replacement['at'])
    timings = []
    for line in log.splitlines():
        event = json.loads(line)
        if first['at'] <= event.get('t', 0) <= exit_event['at'] and event.get('ev') == 'run-timing':
            timing = json.loads(event['x'])
            timings.append({'at': event['t'], **{k: timing[k] for k in
                            ('frames', 'elapsedMs', 'recognitionMs', 'embeddingMs')}})
    rows = ledger['rows']
    if len(rows) != 1:
        raise ValueError('Unexpected budget rows')
    row = rows[0]
    hashes = [digest(original), digest(copy), report['sourceSha256']]
    consistent = len(set(hashes)) == 1
    measured = (row['accounting'] == 'measured' and not row['exitPending'] and row['finished'] > 0
                and row['usedMs'] == report['budgetUsedMs']
                and row['usedMs'] >= report['responseDeadlineMs'])
    return {
        'kind': 'actual_device_worker_exit_probe', 'version': '0.1.35',
        'phase': report['phase'], 'response_deadline_ms': report['responseDeadlineMs'],
        'timeout_observed': report['timeoutObserved'], 'exit_confirmed': report['exitConfirmed'],
        'replacement_health_reply': report['replacementHealth'],
        'lifecycle_order_independently_checked': ordered,
        'timeout_to_exit_ms': exit_event['at'] - closing['at'],
        'exit_to_replacement_creation_ms': replacement['at'] - exit_event['at'],
        'budget_used_ms': row['usedMs'], 'budget_accounting': row['accounting'],
        'tail_in_measured_budget': measured, 'source_bytes': original.stat().st_size,
        'source_sha256': hashes[0], 'source_and_copy_preserved': consistent,
        'native_timings': timings, 'events': safe,
        'verified': report['phase'] == 'verified' and ordered and measured and consistent,
        'scope': 'isolated saved audio copy; no acquisition, publication, upload, summary or Agent task',
        'limits': ['one foreground timeout sample', 'elapsed occupancy is not CPU metering',
                   'no universal native hard-stop guarantee', 'no eight-hour or uncharged acceptance'],
        'canonical_report_sha256': hashlib.sha256(json.dumps(report, sort_keys=True).encode()).hexdigest(),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('report', 'ledger', 'log', 'original', 'copy', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    result = summarize(json.loads(args.report.read_text(encoding='utf-8-sig')),
                       json.loads(args.ledger.read_text(encoding='utf-8-sig')),
                       args.log.read_text(encoding='utf-8-sig'), args.original, args.copy)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('verified', 'timeout_to_exit_ms', 'budget_used_ms',
                                           'source_and_copy_preserved')}))
