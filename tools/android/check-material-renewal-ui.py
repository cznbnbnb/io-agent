"""Dev2 normal entry, real queue preservation and manual repeat; no text export."""
from pathlib import Path
import importlib.util
import json
import re
import time

spec = importlib.util.spec_from_file_location('material_ui', Path(__file__).with_name('check-material-ui.py'))
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)


def counts(nodes):
    values = [n.get('text', '') for n in nodes if n.get('package') == ui.PKG]
    match = next((v for v in values if re.fullmatch(r'服务器已存 \d+ · 待同步 \d+\n待核对 \d+ · 结果未知 \d+ · 已过期 \d+', v)), None)
    if match is None:
        raise RuntimeError('MATERIAL_COUNTS_MISSING')
    return list(map(int, re.findall(r'\d+', match)))


def main():
    report = {'schema': 1, 'candidate': '0.5.2-dev2 /10418', 'checks': {},
              'microphone_started': False, 'credentials_or_text_exported': False}
    try:
        package = ui.call(['shell', 'dumpsys', 'package', ui.PKG])
        if not re.search(r'versionCode=10418\b', package) or 'versionName=0.5.2-dev2' not in package:
            raise RuntimeError('MATERIAL_CANDIDATE_MISMATCH')
        ui.call(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
        ui.call(['shell', 'wm', 'dismiss-keyguard'])
        ui.call(['shell', 'am', 'force-stop', ui.PKG])
        ui.call(['shell', 'am', 'start', '-n', ui.PKG + '/com.rayneo.venus.MainActivity'])
        ui.click('iO Agent')
        ui.click('资料同步')
        nodes = ui.wait_label('同步一次')
        if not any('turboio-user' in n.get('text', '') and 'phone-android' in n.get('text', '') for n in nodes):
            raise RuntimeError('FORMAL_CONFIG_NOT_PRESERVED')
        if counts(nodes) != [3, 0, 0, 0, 0]:
            raise RuntimeError('FORMAL_QUEUE_NOT_PRESERVED')
        report['checks']['restart_login_formal_config_and_three_stored_records'] = True
        ui.click('同步一次')
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            nodes = ui.nodes()
            values = [n.get('text', '') for n in nodes if n.get('package') == ui.PKG]
            if '服务器已确认保存' in values and '正在同步，可随时暂停。' not in values:
                report['counts'] = counts(nodes)
                if report['counts'] != [3, 0, 0, 0, 0]:
                    raise RuntimeError('MATERIAL_REPEAT_COUNTS_CHANGED')
                report['checks']['normal_manual_repeat_completed'] = True
                break
        else:
            raise RuntimeError('MATERIAL_REPEAT_NOT_CONFIRMED')
        report['passed'] = True
    except Exception as error:
        code = str(error)
        report.update(passed=False, error=code if re.fullmatch(r'[A-Z_]{3,90}', code) else type(error).__name__)
    report['at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    (ui.ROOT / 'phone-material-renewal-ui-2026-10-21.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
