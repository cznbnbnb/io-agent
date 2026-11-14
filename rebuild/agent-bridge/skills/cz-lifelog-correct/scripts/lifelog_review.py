#!/usr/bin/env python3
"""Offline review preparation, request construction, and cloud readback verification."""
import argparse
import copy
import hashlib
import json
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

REVIEW_VERSION = 4


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def snapshot(path):
    data = read_json(path)
    require(data.get('complete') is True and data.get('has_more') is False,
            'Need a complete daily response: finish pagination and preserve coverage metadata.')
    items = data['items']
    ids = [m['material_id'] for m in items]
    require(len(ids) == len(set(ids)), 'Duplicate material IDs in snapshot.')
    for material in items:
        ids = [b['id'] for b in material['blocks']]
        require(len(ids) == len(set(ids)), 'Duplicate block IDs in ' + material['material_id'])
    return data, {m['material_id']: m for m in items}


def fingerprint(material):
    fields = ['material_id', 'revision', 'correction_revision', 'dependencies_version',
              'needs_review', 'summary_stale', 'conflict_blocks', 'blocks', 'notes']
    content = {k: material.get(k) for k in fields}
    raw = json.dumps(content, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def paragraphs(blocks):
    """Index candidate paragraphs; a daily summary can be one large block."""
    return {f'{b["id"]}#{n}': part for b in blocks
            for n, part in enumerate((p.strip() for p in b['text'].replace('\r\n', '\n').split('\n\n') if p.strip()), 1)}


def valid_sources(sources):
    return isinstance(sources, list) and bool(sources) and all(
        isinstance(s, dict) and all(isinstance(s.get(k), str) and s[k].strip() for k in ('ref', 'quote'))
        for s in sources)


def load_events(decisions_path):
    path = Path(decisions_path).with_name('events.json')
    require(path.is_file(), 'Missing events.json beside decisions. Run prepare and review the event boundaries first.')
    events = read_json(path)
    require(isinstance(events, dict), 'events.json should map event IDs to event records.')
    for eid, event in events.items():
        require(eid.strip() and isinstance(event, dict)
                and event.get('relation') in ('own', 'participated', 'background', 'uncertain')
                and isinstance(event.get('scene'), str) and event['scene'].strip()
                and valid_sources(event.get('sources')),
                'Event needs a scene, relation and source with an exact quote: ' + eid)
    return events


def check_facts(decision, units, events, kind):
    """Check review coverage and anchors, not whether a source entails a claim."""
    review = decision.get('fact_review')
    require(isinstance(review, dict), 'Missing fact_review for ' + decision['material_id'])
    require(set(units) == set(review),
            'Paragraph coverage mismatch: ' + decision['material_id'])
    require(not (decision['status'] == 'verified_unchanged' and decision.get('unresolved')),
            'A summary with open questions cannot be verified_unchanged: ' + decision['material_id'])
    supported = outstanding = 0
    used_events = set()
    has_focus = False
    for key, paragraph in units.items():
        row = review[key]
        require(isinstance(row, dict), 'Invalid review row: ' + key)
        checks = row.get('checks', [])
        if not checks:
            require(isinstance(row.get('no_risk'), str) and row['no_risk'].strip(),
                    'Unchecked paragraph (needs claim evidence or a concrete no_risk reason): ' + key)
            continue
        require(isinstance(checks, list) and not row.get('no_risk'), 'Ambiguous review row: ' + key)
        for check in checks:
            require(isinstance(check, dict) and isinstance(check.get('text'), str)
                    and check['text'].strip() and check['text'] in paragraph,
                    'Claim is not an exact excerpt of the candidate: ' + key)
            eid = check.get('event')
            use = check.get('use')
            require(isinstance(eid, str) and eid in events, 'Claim needs a reviewed event: ' + key)
            require(use in ('focus', 'personal', 'context'), 'Claim needs focus, personal or context: ' + key)
            used_events.add(eid)
            if use in ('personal', 'focus'):
                require(events[eid]['relation'] in ('own', 'participated') and not check.get('open'),
                        'Background, uncertain or open claims cannot anchor personal actions or focus: ' + key)
            if use == 'focus':
                has_focus = True
            if check.get('open'):
                require(check['open'] in decision.get('unresolved', [])
                        and decision.get('status') in ('unresolved', 'corrected'),
                        'Open claim must have a matching unresolved question and status: ' + key)
                outstanding += 1
                continue
            sources = check.get('sources')
            require(valid_sources(sources),
                    'Each supported claim needs a source locator and its direct quote: ' + key)
            supported += 1
    if kind == 'summary':
        neutral = decision.get('neutral_focus_reason', '')
        require(isinstance(neutral, str) and has_focus != bool(neutral.strip()),
                'Mark the supported daily focus or explain why the opening is neutral (choose one).')
    return supported, outstanding, used_events


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', action='version', version=f'cz-lifelog-correct v{REVIEW_VERSION}')
    sub = parser.add_subparsers(dest='command', required=True)
    day = sub.add_parser('date', help='Compute yesterday and bounded context in UTC+08:00.')
    day.add_argument('--date')
    day.add_argument('--now', help='Optional ISO timestamp with offset for reproducible runs.')
    prep = sub.add_parser('prepare', help='Split a full daily snapshot into readable materials.')
    prep.add_argument('--snapshot', required=True)
    prep.add_argument('--out', required=True, help='A new directory, never an existing run directory.')
    prep.add_argument('--ledger', help='A previous verify ledger; matches are hints, not automatic approval.')
    req = sub.add_parser('request', help='Validate one material plan and construct a stable request; no network.')
    req.add_argument('--snapshot', required=True, help='Fresh daily response immediately before this write.')
    req.add_argument('--plan', required=True)
    req.add_argument('--baseline', help='Last effective snapshot for a currently stale summary.')
    req.add_argument('--decisions', help='Required for summary/segment requests. Keep events.json beside this file.')
    req.add_argument('--out', required=True)
    verify = sub.add_parser('verify', help='Verify a complete run against saved requests and review decisions.')
    verify.add_argument('--before', required=True)
    verify.add_argument('--after', required=True)
    verify.add_argument('--requests', required=True, help='Directory containing only successful request JSON files.')
    verify.add_argument('--decisions', required=True)
    verify.add_argument('--out', required=True)
    verify.add_argument('--ledger-out', required=True)
    args = parser.parse_args()

    if args.command == 'date':
        china = timezone(timedelta(hours=8), 'Asia/Shanghai')
        now = datetime.fromisoformat(args.now.replace('Z', '+00:00')) if args.now else datetime.now(china)
        require(now.tzinfo is not None, '--now requires an explicit timezone offset.')
        now = now.astimezone(china)
        target = date.fromisoformat(args.date) if args.date else now.date() - timedelta(days=1)
        start = datetime.combine(target, time(), china)
        require(start < now, 'Target day is in the future.')
        print(json.dumps({'date': str(target), 'timezone': 'Asia/Shanghai',
                          'day_start': start.isoformat(),
                          'day_end': min(start + timedelta(days=1), now).isoformat(),
                          'context_start': (start - timedelta(days=2)).isoformat(),
                          'context_end': min(start + timedelta(days=3), now).isoformat(),
                          'run_at': now.isoformat()}, ensure_ascii=False, indent=2))
        return

    if args.command == 'prepare':
        data, items = snapshot(args.snapshot)
        out = Path(args.out)
        require(not out.exists(), 'Use a new run directory; existing review files will not be overwritten.')
        out.mkdir(parents=True)
        prior = {m['material_id']: m for m in read_json(args.ledger)} if args.ledger else {}
        index, decisions = [], []
        for i, m in enumerate(items.values()):
            digest = fingerprint(m)
            old = prior.get(m['material_id'], {})
            same = (old.get('fingerprint') == digest and old.get('review_version') == REVIEW_VERSION
                    and old.get('status') in ('corrected', 'verified_unchanged') and not old.get('unresolved'))
            name = f'{i:03d}-{m["kind"]}.txt'
            lines = [f'{m["material_id"]} | {m["date"]} | {m["kind"]}',
                     f'source={m["revision"]} correction={m["correction_revision"]} stale={m["summary_stale"]} review={m["needs_review"]}']
            for n, block in enumerate(m['blocks']):
                lines.extend(['', f'[{n}] {block["id"]} | {block.get("speaker", "unknown")} | {block.get("started_at", "")} — {block.get("ended_at", "")}', block['text']])
            (out / name).write_text('\n'.join(lines) + '\n', encoding='utf-8')
            index.append({'material_id': m['material_id'], 'kind': m['kind'], 'file': name,
                          'blocks': len(m['blocks']), 'fingerprint': digest,
                          'cached_fingerprint_matches': same,
                          'previous_decision': old.get('status') if same else None})
            decisions.append({'material_id': m['material_id'], 'status': 'pending',
                              'reason': '', 'evidence_refs': [], 'unresolved': []})
            if m['kind'] in ('summary', 'segment'):
                decisions[-1]['fact_review'] = {key: {'checks': []} for key in paragraphs(m['blocks'])}
            if m['kind'] == 'summary':
                decisions[-1]['neutral_focus_reason'] = ''
        save_json(out / 'index.json', index)
        save_json(out / 'decisions.json', decisions)
        save_json(out / 'events.json', {})
        print(json.dumps({'materials': len(items), 'cached_matches': sum(m['cached_fingerprint_matches'] for m in index),
                          'coverage': data.get('coverage'), 'directory': str(out)}, ensure_ascii=False))
        return

    if args.command == 'request':
        _, items = snapshot(args.snapshot)
        plan = read_json(args.plan)
        m = items[plan['material_id']]
        require(plan['source_revision'] == m['revision'], 'Source revision changed; reread and merge.')
        require(plan['correction_revision'] == m['correction_revision'], 'Correction revision changed; reread and merge.')
        require(not m['needs_review'] and not m.get('conflict_blocks'), 'Resolve source conflicts through history before using this helper.')
        base = m
        if m['summary_stale']:
            require(m['kind'] != 'transcript' and args.baseline, 'Stale summary needs a last-effective baseline.')
            _, baseline = snapshot(args.baseline)
            base = baseline[m['material_id']]
            require(base['revision'] == m['revision'] and base['correction_revision'] == m['correction_revision'],
                    'Baseline version mismatch: recover the latest effective summary, not raw phone original.')
            require(bool(base['blocks']), 'Baseline has no effective summary text.')
        blocks = {b['id']: b for b in base['blocks']}
        require(isinstance(plan['reason'], str) and bool(plan['reason'].strip()), 'A concrete reason is required.')
        evidence = plan['evidence']
        require(isinstance(evidence, list) and 1 <= len(evidence) <= 20
                and all(isinstance(e, str) and e.strip() for e in evidence), 'Use 1–20 nonempty evidence strings.')
        edits = plan['edits']
        require(1 <= len(edits) <= 200, 'Use 1–200 edits per request.')
        require(len({e['block_id'] for e in edits}) == len(edits), 'Duplicate block edit.')
        for e in edits:
            require(e['block_id'] in blocks, 'Unknown block ID.')
            require(blocks[e['block_id']]['text'] == e['before'], 'Before-text mismatch; reread and merge.')
            require(isinstance(e['text'], str), 'Edited text must be a string.')
        changed = sum(e['text'] != e['before'] for e in edits)
        require(changed > 0 or m['summary_stale'], 'No-op edit rejected; record unchanged review locally.')
        payload = {'material_id': m['material_id'], 'expected_source_revision': m['revision'],
                   'expected_revision': m['correction_revision'], 'agent': plan.get('agent', 'WorkBuddy'),
                   'reason': plan['reason'], 'evidence': evidence,
                   'edits': [{'block_id': e['block_id'], 'text': e['text']} for e in edits]}
        if m['kind'] != 'transcript':
            require(args.decisions, 'Summary write requires --decisions from the v4 event and fact review.')
            matches = [d for d in read_json(args.decisions) if d['material_id'] == m['material_id']]
            require(len(matches) == 1 and matches[0]['status'] in ('corrected', 'verified_unchanged', 'unresolved'),
                    'Missing or unfinished summary decision.')
            replacements = {e['block_id']: e['text'] for e in edits}
            candidate = [{'id': bid, 'text': replacements.get(bid, b['text'])} for bid, b in blocks.items()]
            check_facts(matches[0], paragraphs(candidate), load_events(args.decisions), m['kind'])
            require(plan['dependencies_version'] == m['dependencies_version'], 'Summary dependencies changed; reread and recheck.')
            payload['dependencies_version'] = m['dependencies_version']
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()[:32]
        payload['request_id'] = 'lifelog-' + digest
        require(len((json.dumps(payload, ensure_ascii=False, indent=2) + '\n').encode('utf-8')) <= 1024 * 1024, 'Request exceeds 1 MiB.')
        dest = Path(args.out)
        require(not dest.exists() or read_json(dest) == payload, 'Output already contains a different request; use a new filename.')
        save_json(dest, payload)
        print(json.dumps({'request_id': payload['request_id'], 'material_id': m['material_id'],
                          'edits': len(edits), 'text_changes': changed, 'network_write_performed': False}))
        return

    before_data, before = snapshot(args.before)
    after_data, after = snapshot(args.after)
    require(set(before) == set(after), 'Inventory changed: review new/missing material before claiming completion.')
    decisions_list = read_json(args.decisions)
    decisions = {d['material_id']: d for d in decisions_list}
    require(len(decisions) == len(decisions_list) and set(decisions) == set(before), 'Need exactly one review decision per material.')
    request_dir = Path(args.requests)
    require(request_dir.is_dir(), 'Requests directory does not exist.')
    requests = [read_json(q) for q in sorted(request_dir.glob('*.json'))]
    require(len({r['request_id'] for r in requests}) == len(requests), 'Duplicate saved request ID.')
    require(all(r['material_id'] in before for r in requests), 'Request outside this snapshot scope.')
    grouped = {mid: [] for mid in before}
    for r in requests:
        grouped[r['material_id']].append(r)
    diffs, ledger, errors = [], [], []
    supported_claims = open_claims = 0
    events = load_events(args.decisions) if any(m['kind'] in ('summary', 'segment') for m in after.values()) else {}
    for mid, base in before.items():
        current, decision = after[mid], decisions[mid]
        require(decision['status'] in ['corrected', 'verified_unchanged', 'unresolved'], 'Unreviewed or invalid decision: ' + mid)
        require(bool(decision['reason'].strip()), 'Review reason missing: ' + mid)
        if decision['status'] == 'unresolved':
            require(bool(decision['unresolved']), 'Unresolved decision needs a concrete question: ' + mid)
        used_events = set()
        if current['kind'] in ('summary', 'segment'):
            s, o, used_events = check_facts(decision, paragraphs(current['blocks']), events, current['kind'])
            supported_claims += s
            open_claims += o
        expected = copy.deepcopy(base['blocks'])
        by_block = {b['id']: b for b in expected}
        revision = base['correction_revision']
        for r in sorted(grouped[mid], key=lambda r: r['expected_revision']):
            require(r['expected_revision'] == revision and r['expected_source_revision'] == base['revision'],
                    'Request version chain mismatch: ' + mid)
            for e in r['edits']:
                require(e['block_id'] in by_block, 'Recover baseline blocks before verification: ' + mid)
                by_block[e['block_id']]['text'] = e['text']
            revision += 1
        for field in ['material_id', 'date', 'timezone', 'kind', 'revision', 'started_at', 'ended_at', 'stored_at']:
            if base.get(field) != current.get(field):
                errors.append([mid, 'source_metadata_changed', field])
        if current['correction_revision'] != revision:
            errors.append([mid, 'correction_revision_mismatch'])
        if current['summary_stale'] or current['needs_review'] or current.get('conflict_blocks'):
            errors.append([mid, 'stale_or_conflicted'])
        actual = copy.deepcopy(current['blocks'])
        for blocks in [expected, actual]:
            for b in blocks:
                b.pop('corrected', None)
        if actual != expected:
            errors.append([mid, 'unexpected_block_change_or_missing_write'])
        changes = [{'block_id': a['id'], 'before': a['text'], 'after': b['text']}
                   for a, b in zip(base['blocks'], current['blocks']) if a['id'] == b['id'] and a['text'] != b['text']]
        if changes:
            require(decision['status'] == 'corrected', 'Changed material must be recorded as corrected: ' + mid)
            diffs.append({'material_id': mid, 'edits': changes})
        elif decision['status'] == 'corrected':
            errors.append([mid, 'claimed_correction_without_text_change'])
        ledger.append({**decision, 'review_version': REVIEW_VERSION, 'events': {eid: events[eid] for eid in sorted(used_events)},
                       'date': current['date'], 'fingerprint': fingerprint(current),
                       'source_revision': current['revision'], 'correction_revision': current['correction_revision'],
                       'dependencies_version': current['dependencies_version'],
                       'verified_at': after_data.get('retrieved_at')})
    report = {'verified': not errors, 'review_version': REVIEW_VERSION, 'claims_with_source_quotes': supported_claims,
              'claims_left_open': open_claims, 'semantic_accuracy_machine_verified': False,
              'materials_reviewed': len(before), 'materials_written': len({r['material_id'] for r in requests}),
              'requests': len(requests), 'materials_text_changed': len(diffs),
              'blocks_text_changed': sum(len(d['edits']) for d in diffs),
              'materials_with_unresolved_questions': sum(bool(d.get('unresolved')) for d in decisions.values()),
              'coverage': after_data.get('coverage'), 'errors': errors, 'diffs': diffs}
    save_json(args.out, report)
    require(not errors, 'Verification failed; inspect report. No verified ledger was written.')
    save_json(args.ledger_out, ledger)
    print(json.dumps({k: v for k, v in report.items() if k != 'diffs'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
