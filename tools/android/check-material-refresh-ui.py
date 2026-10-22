"""Dev5 normal foreground refresh, then process restart and idempotent repeat.
Only status/counts are exported. No microphone, task answer or data clearing.
"""
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
    line = next((v for v in values if re.fullmatch(r'服务器已存版本 \d+ · 待同步版本 \d+\n待核对 \d+ · 结果未知 \d+ · 已过期 \d+', v)), None)
    if line is None:
        raise RuntimeError('MATERIAL_COUNTS_MISSING')
    return list(map(int, re.findall(r'\d+', line)))

def open_sync(paused=False):
    ui.call(['shell', 'am', 'force-stop', ui.PKG])
    ui.call(['shell', 'am', 'start', '-n', ui.PKG + '/com.rayneo.venus.MainActivity'])
    ui.click('iO Agent')
    ui.click('资料同步')
    nodes = ui.wait_label('同步已暂停，本机队列保留' if paused else '同步一次')
    if not any('turboio-user' in n.get('text', '') and 'phone-android' in n.get('text', '') for n in nodes):
        raise RuntimeError('FORMAL_CONFIG_NOT_PRESERVED')
    return counts(nodes)

def sync_once():
    ui.click('同步一次')
    deadline = time.monotonic() + 110
    while time.monotonic() < deadline:
        nodes = ui.nodes()
        values = [n.get('text', '') for n in nodes if n.get('package') == ui.PKG]
        if any(v in values for v in ('同步暂未完成，请检查网络或连接配置后重试', '待同步正文已有新修改，旧版本暂不发送，需核对其入库结果', '暂时无法读取官方最新正文，已保留本机队列，请稍后重试', '有资料需要核对，未记为同步成功', '旧修订版本需要核对，资料已保留；请联网后重试同步')):
            raise RuntimeError('MATERIAL_REFRESH_REPORTED_ERROR')
        if '服务器已确认保存' in values and '正在同步，可随时暂停。' not in values:
            value = counts(nodes)
            if value[1:] != [0, 0, 0, 0]:
                raise RuntimeError('MATERIAL_PENDING_AFTER_REFRESH')
            return value
        time.sleep(0.4)
    raise RuntimeError('MATERIAL_REFRESH_NOT_CONFIRMED')

def main():
    report = {'schema': 1, 'candidate': '0.5.2-dev5 /10421', 'microphone_started': False,
              'credentials_or_text_exported': False, 'checks': {}}
    try:
        package = ui.call(['shell', 'dumpsys', 'package', ui.PKG])
        if not re.search(r'versionCode=10421\b', package) or 'versionName=0.5.2-dev5' not in package:
            raise RuntimeError('MATERIAL_CANDIDATE_MISMATCH')
        ui.call(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
        ui.call(['shell', 'wm', 'dismiss-keyguard'])
        report['before'] = open_sync(paused=True)
        if report['before'] != [3, 0, 3, 0, 0]:
            raise RuntimeError('FORMAL_QUEUE_NOT_PRESERVED')
        report['checks']['original_three_versions_and_rejected_queue_preserved'] = True
        ui.click('资料连接设置')
        ui.click('读取已保存连接')
        ui.click('允许将当前账号的智记同步到此服务器')
        ui.click('核对并保存')
        ui.wait_label('同步一次')
        report['checks']['existing_authorized_connection_reenabled'] = True
        report['after'] = sync_once()
        if report['after'][0] != 6:
            raise RuntimeError('MATERIAL_REVISION_COUNT_UNEXPECTED')
        report['checks']['normal_refresh_completed'] = True
        report['restart'] = open_sync()
        if report['restart'] != report['after']:
            raise RuntimeError('MATERIAL_RESTART_COUNTS_CHANGED')
        report['repeat'] = sync_once()
        if report['repeat'] != report['after']:
            raise RuntimeError('MATERIAL_REPEAT_COUNTS_CHANGED')
        report['checks']['restart_and_repeat_preserved_versions'] = True
        report['passed'] = True
    except Exception as error:
        code = str(error)
        report.update(passed=False, error=code if re.fullmatch(r'[A-Z_]{3,90}', code) else type(error).__name__)
        try:
            values=ui.nodes()
            if any(n.get('package')==ui.PKG and n.get('text')=='暂停同步' for n in values):
                ui.click('暂停同步');ui.wait_label('同步已暂停，本机队列保留');report['paused_after_failure']=True
        except Exception:
            report['pause_after_failure_unconfirmed']=True
    report['at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    (ui.ROOT / 'phone-material-refresh-ui-2026-10-21.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['passed'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
