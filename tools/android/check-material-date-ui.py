"""Dev6 date sync through observed native controls, limited to audited dates.

No arbitrary dates, text export, recording, data clearing or credential changes.
An unsupported picker stops with a restricted control-shape summary.
"""
from pathlib import Path
from datetime import date
from collections import Counter
import importlib.util
import json
import re
import time

spec = importlib.util.spec_from_file_location('material_ui', Path(__file__).with_name('check-material-ui.py'))
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
EXPECTED_COUNTS = [6, 0, 0, 0, 0]
PROGRESS = '正在按日期同步…'
MONTHS = {name: i for i, name in enumerate(('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'), 1)}
PICKER_IDS = {'datePicker', 'date_picker_header_year', 'date_picker_header_date', 'day_picker_view', 'month_view', 'prev', 'next', 'year_picker', 'date_picker_year_picker', 'date_picker_day_picker'}


def parsed_date(value):
    """Accept whole accessibility labels only; never search arbitrary text."""
    value = value.strip()
    match = re.fullmatch(r'(\d{4})年(\d{1,2})月(\d{1,2})日(?:[，, ]*(?:星期|周)[一二三四五六日天])?', value)
    if match:
        parts = tuple(map(int, match.groups()))
    else:
        match = re.fullmatch(r'(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),? )?(\d{1,2}) (' + '|'.join(MONTHS) + r') (\d{4})', value)
        if match:
            parts = (int(match[3]), MONTHS[match[2]], int(match[1]))
        else:
            match = re.fullmatch(r'(' + '|'.join(MONTHS) + r') (\d{1,2}),? (\d{4})', value)
            if not match:
                return None
            parts = (int(match[3]), MONTHS[match[1]], int(match[2]))
    try:
        return date(*parts)
    except ValueError:
        return None


def own(nodes):
    return [n for n in nodes if n.get('package') == ui.PKG]


def rid(node):
    return node.get('resource-id', '').removeprefix('android:id/')


def picker_nodes(nodes):
    values = own(nodes)
    if not any(n.get('resource-id', '').startswith('android:id/') and rid(n) in PICKER_IDS for n in values):
        raise RuntimeError('DATE_PICKER_SHAPE_UNSUPPORTED')
    return values


def picker_shape(nodes):
    """Export only framework date controls and full date accessibility labels."""
    result = []
    for node in own(nodes):
        resource = node.get('resource-id', '')
        description = node.get('content-desc', '')
        day = parsed_date(description)
        value = node.get('text', '')
        date_cell = (re.fullmatch(r'\d{1,2}', value) and node.get('class') == 'android.view.View'
                     and len(description) <= 80 and re.fullmatch(r'[0-9A-Za-z 年月日星期周一二三四五六天，,./-]+', description))
        if not day and not date_cell and not (resource.startswith('android:id/') and rid(node) in PICKER_IDS | {'button1', 'button2'}):
            continue
        item = {key: node.get(key, '') for key in ('resource-id', 'class', 'clickable', 'enabled', 'selected', 'bounds')}
        if day:
            item['date'] = day.isoformat()
        elif date_cell:
            item['date_label'] = description
        if value in {'取消', '确定', '完成', 'OK', 'CANCEL', 'Cancel'} or re.fullmatch(r'\d{4}', value):
            item['control_text'] = value
        if description in {'上个月', '下个月', 'Previous month', 'Next month'}:
            item['navigation'] = description
        result.append(item)
    return result[:80]


def tap(node):
    if node.get('package') != ui.PKG or node.get('clickable') != 'true' or node.get('enabled') != 'true':
        raise RuntimeError('DATE_CONTROL_NOT_ACTIONABLE')
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
    if not match:
        raise RuntimeError('DATE_CONTROL_BOUNDS_INVALID')
    left, top, right, bottom = map(int, match.groups())
    if right <= left or bottom <= top:
        raise RuntimeError('DATE_CONTROL_BOUNDS_INVALID')
    ui.call(['shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2)])


def single(nodes):
    if len(nodes) != 1:
        raise RuntimeError('DATE_CONTROL_AMBIGUOUS')
    return nodes[0]


def button(nodes, resource, labels):
    return single([n for n in picker_nodes(nodes) if n.get('resource-id') == 'android:id/' + resource and n.get('text') in labels])


def counts(nodes):
    pattern = r'服务器已存版本 \d+ · 待同步版本 \d+\n待核对 \d+ · 结果未知 \d+ · 已过期 \d+'
    line = single([n for n in own(nodes) if re.fullmatch(pattern, n.get('text', ''))])
    return list(map(int, re.findall(r'\d+', line.get('text'))))


def open_sync():
    ui.call(['shell', 'am', 'force-stop', ui.PKG])
    ui.call(['shell', 'am', 'start', '-n', ui.PKG + '/com.rayneo.venus.MainActivity'])
    ui.click('iO Agent')
    ui.click('资料同步')
    nodes = ui.wait_label('按日期同步')
    if not any('turboio-user' in n.get('text', '') and 'phone-android' in n.get('text', '') for n in own(nodes)):
        raise RuntimeError('FORMAL_CONFIG_NOT_PRESERVED')
    if counts(nodes) != EXPECTED_COUNTS:
        raise RuntimeError('FORMAL_QUEUE_COUNTS_UNEXPECTED')
    return nodes


def select_spinner(target, nodes):
    fields = [('year', target.year), ('month', target.month), ('day', target.day)]
    for name, expected in fields:
        branch = single([n for n in own(nodes) if n.get('resource-id') == 'android:id/' + name])
        field = single([n for n in branch.iter('node') if n.get('resource-id') == 'android:id/numberpicker_input' and n.get('class') == 'android.widget.EditText'])
        raw = field.get('text', '')
        if not re.fullmatch(r'[0-9]{1,4}', raw):
            raise RuntimeError('DATE_SPINNER_VALUE_UNSUPPORTED')
        if int(raw) != expected:
            tap(field)
            focused = ui.nodes()
            matches = [n for n in own(focused) if n.get('resource-id') == 'android:id/' + name]
            if not matches or not any(n.get('focused') == 'true' and n.get('class') == 'android.widget.EditText' for n in matches[0].iter('node')):
                raise RuntimeError('DATE_SPINNER_FOCUS_UNCONFIRMED')
            ui.call(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'])
            ui.call(['shell', 'input', 'keyevent'] + ['KEYCODE_DEL'] * len(raw))
            ui.call(['shell', 'input', 'text', str(expected)])
            ui.call(['shell', 'input', 'keyevent', 'KEYCODE_TAB'])
            nodes = ui.nodes()
    for name, expected in fields:
        branch = single([n for n in own(nodes) if n.get('resource-id') == 'android:id/' + name])
        field = single([n for n in branch.iter('node') if n.get('resource-id') == 'android:id/numberpicker_input'])
        if field.get('text') != str(expected):
            raise RuntimeError('DATE_SPINNER_SELECTION_UNCONFIRMED')
    tap(button(nodes, 'button1', {'确定', '完成', 'OK'}))


def select_date(target, report):
    ui.click('按日期同步')
    previous_month = None
    for _ in range(25):
        nodes = ui.nodes()
        report['last_picker_shape'] = picker_shape(nodes)
        values = picker_nodes(nodes)
        if all(any(n.get('resource-id') == 'android:id/' + name for n in values) for name in ('year', 'month', 'day')):
            select_spinner(target, nodes)
            return
        matches = [n for n in values if parsed_date(n.get('content-desc', '')) == target]
        if matches:
            tap(single(matches))
            selected = ui.nodes()
            if not any(parsed_date(n.get('content-desc', '')) == target and n.get('selected') == 'true' for n in own(selected)):
                raise RuntimeError('DATE_SELECTION_NOT_CONFIRMED')
            tap(button(selected, 'button1', {'确定', '完成', 'OK'}))
            return
        cells = [parsed_date(n.get('content-desc', '')) for n in values]
        months = Counter((d.year, d.month) for d in cells if d)
        if not months:
            raise RuntimeError('DATE_PICKER_MONTH_UNOBSERVABLE')
        ordered = months.most_common()
        if len(ordered) > 1 and ordered[0][1] == ordered[1][1]:
            raise RuntimeError('DATE_PICKER_MONTH_AMBIGUOUS')
        current = ordered[0][0]
        if current == previous_month:
            raise RuntimeError('DATE_PICKER_NAVIGATION_UNCONFIRMED')
        if current == (target.year, target.month):
            raise RuntimeError('DATE_PICKER_DAY_UNOBSERVABLE')
        forward = current < (target.year, target.month)
        resource = 'android:id/' + ('next' if forward else 'prev')
        descriptions = {'下个月', 'Next month'} if forward else {'上个月', 'Previous month'}
        navigation = [n for n in values if n.get('resource-id') == resource or n.get('content-desc') in descriptions]
        tap(single(navigation))
        previous_month = current
    raise RuntimeError('DATE_PICKER_NAVIGATION_LIMIT')


def sync_day(item, report):
    target = date.fromisoformat(item['date'])
    scope = '本次读取 1 天 · 发现智记正文 ' + str(item['sources']) + ' 份'
    prior_scope = any(n.get('text', '').startswith(scope + '\n') for n in own(ui.nodes()))
    select_date(target, report)
    nodes = ui.wait_label('开始同步')
    expected = '日期：' + item['date'] + '\n时区：' + item['timezone'] + '\n'
    messages = [n.get('text', '') for n in own(nodes)]
    if not any(v.startswith(expected) and 'turboio-user' in v and 'phone-android' in v for v in messages):
        raise RuntimeError('DATE_CONFIRMATION_SCOPE_MISMATCH')
    ui.click('开始同步')
    deadline = time.monotonic() + 110
    progress_seen = False
    scope = '本次读取 1 天 · 发现智记正文 ' + str(item['sources']) + ' 份'
    while time.monotonic() < deadline:
        nodes = ui.nodes()
        values = [n.get('text', '') for n in own(nodes)]
        progress_seen = progress_seen or PROGRESS in values
        if '知道了' in values:
            raise RuntimeError('DATE_SYNC_REPORTED_ERROR')
        if (progress_seen or not prior_scope) and PROGRESS not in values and '服务器已确认保存' in values and any(v.startswith(scope + '\n') for v in values):
            result = counts(nodes)
            if result != EXPECTED_COUNTS:
                raise RuntimeError('DATE_SYNC_COUNTS_CHANGED')
            return {'date': item['date'], 'timezone': item['timezone'], 'sources': item['sources'], 'counts': result, 'progress_observed': progress_seen, 'fresh_scope_observed': not prior_scope}
        time.sleep(0.4)
    raise RuntimeError('DATE_SYNC_COMPLETION_UNCONFIRMED')


def main():
    report = {'schema': 1, 'candidate': '0.5.2-dev6 /10422', 'normal_ui': True, 'microphone_started': False,
              'credentials_or_text_exported': False, 'data_cleared': False, 'checks': {}}
    try:
        audit = json.loads((ui.ROOT / 'phone-formal-material-audit-dev6-2026-10-21.json').read_text(encoding='utf-8'))
        days = audit['audit']['discovery_test_days']
        if audit.get('passed') is not True or not isinstance(days, list) or len(days) != 2 or sorted(d['sources'] for d in days) != [1, 2]:
            raise RuntimeError('DATE_AUDIT_NOT_VERIFIED')
        if len({d['date'] for d in days}) != 2:
            raise RuntimeError('DATE_AUDIT_SCOPE_INVALID')
        for item in days:
            if date.fromisoformat(item['date']).isoformat() != item['date'] or not re.fullmatch(r'[A-Za-z_]+/[A-Za-z_]+(?:/[A-Za-z_]+)?', item['timezone']):
                raise RuntimeError('DATE_AUDIT_SCOPE_INVALID')
        timezone = ui.call(['shell', 'getprop', 'persist.sys.timezone']).strip()
        if any(item['timezone'] != timezone for item in days):
            raise RuntimeError('DATE_DEVICE_TIMEZONE_MISMATCH')
        package = ui.call(['shell', 'dumpsys', 'package', ui.PKG])
        if not re.search(r'versionCode=10422\b', package) or not re.search(r'versionName=0\.5\.2-dev6\b', package):
            raise RuntimeError('MATERIAL_CANDIDATE_MISMATCH')
        ui.call(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
        ui.call(['shell', 'wm', 'dismiss-keyguard'])
        report['before'] = counts(open_sync())
        ui.click('按日期同步')
        nodes = ui.nodes()
        report['last_picker_shape'] = picker_shape(nodes)
        tap(button(nodes, 'button2', {'取消', 'CANCEL', 'Cancel'}))
        nodes = ui.wait_label('按日期同步')
        if counts(nodes) != EXPECTED_COUNTS or any(n.get('text') == PROGRESS for n in own(nodes)):
            raise RuntimeError('DATE_CANCEL_CHANGED_UI_STATE')
        report['checks']['picker_cancel_returned_without_starting_sync_ui'] = True
        report['runs'] = [sync_day(item, report) for item in days]
        report['checks']['two_known_dates_completed'] = True
        report['restart'] = counts(open_sync())
        report['repeat'] = [sync_day(days[0], report)]
        report['checks']['restart_repeat_preserved_six_versions'] = True
        report.pop('last_picker_shape', None)
        report['passed'] = True
    except Exception as error:
        message = str(error)
        report.update(passed=False, error=message if re.fullmatch(r'[A-Z_]{3,90}', message) else type(error).__name__)
        # No generic UI dump or blind recovery click: leave the observed state for review.
    report['at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    (ui.ROOT / 'phone-material-date-ui-2026-10-21.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
