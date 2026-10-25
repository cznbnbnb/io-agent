"""Explicit own-UID diagnostics; never instrument the product process."""
import argparse, hashlib, json, pathlib, re, subprocess, time, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / 'rebuild/android-app'
STAGE = APP / 'build/audio-phone-probe'
PKG = 'com.turboio.audioprobe.codex'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['install', 'seed', 'reload', 'fence', 'recover', 'import', 'export', 'cleanup'])
    parser.add_argument('--serial', required=True)
    parser.add_argument('--serial-sha256', required=True)
    parser.add_argument('--fixture-ms', type=int)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    assert args.apply and re.fullmatch('[a-f0-9]{64}', args.serial_sha256)
    lock = json.loads(subprocess.check_output(['node', 'tools/collab/device-lock.mjs', 'status'], cwd=ROOT))
    assert lock.get('state') == 'held' and lock['owner'] == 'codex'
    build = json.loads((STAGE / 'build-report.json').read_text())
    assert build['package'] == build['target_package'] == PKG and build['debuggable'] is False
    adb = [str(APP / '.tools/sdk/platform-tools/adb'), '-s', args.serial]
    def run(values, timeout=30):
        return subprocess.check_output(adb + values, text=True, timeout=timeout).strip()
    assert hashlib.sha256(run(['shell', 'getprop', 'ro.serialno']).encode()).hexdigest() == args.serial_sha256
    product = run(['shell', 'pm', 'path', 'com.rayneo.venus.pub'])
    assert product.startswith('package:/data/app/') and product.endswith('/base.apk')
    assert run(['shell', 'sha256sum', product[8:]]).split()[0] == build['product_bytecode_expected_sha256']
    present = 'package:' + PKG in run(['shell', 'pm', 'list', 'packages', PKG]).splitlines()
    path = run(['shell', 'pm', 'path', PKG]) if present else ''
    if args.mode == 'install':
        assert not path, 'Inspect the existing diagnostic package before replacing it'
        apk = STAGE / 'probe.apk'
        assert hashlib.sha256(apk.read_bytes()).hexdigest() == build['apk_sha256']
        run(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
        run(['shell', 'wm', 'dismiss-keyguard'])
        run(['shell', 'cmd', 'statusbar', 'collapse'])
        log = STAGE / 'install-output.log'
        clicks = 0
        with log.open('w') as output:
            child = subprocess.Popen(adb + ['install', '-r', str(apk)], stdout=output, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 120
            while child.poll() is None and time.monotonic() < deadline:
                time.sleep(.6)
                temporary = '/data/local/tmp/codex-audio-probe-install.xml'
                try:
                    run(['shell', 'uiautomator', 'dump', temporary], 12)
                    nodes = [n.attrib for n in ET.fromstring(run(['exec-out', 'cat', temporary])).iter('node') if n.get('package') == 'com.miui.securitycenter']
                    controls = [n for n in nodes if n.get('text') == '继续安装' and n.get('enabled') == 'true']
                    if any(n.get('text') == build['label'] for n in nodes) and len(controls) == 1:
                        bounds = list(map(int, re.findall(r'\d+', controls[0]['bounds'])))
                        assert len(bounds) == 4
                        run(['shell', 'input', 'tap', str((bounds[0]+bounds[2])//2), str((bounds[1]+bounds[3])//2)])
                        clicks += 1
                except (subprocess.SubprocessError, ET.ParseError):
                    pass
                finally:
                    run(['shell', 'rm', '-f', temporary])
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=5)
                raise RuntimeError('PROBE_INSTALL_UNCONFIRMED_INSPECT_BEFORE_RETRY')
        assert child.returncode == 0 and 'Success' in log.read_text()
        path = run(['shell', 'pm', 'path', PKG])
        assert path.startswith('package:/data/app/') and run(['shell', 'sha256sum', path[8:]]).split()[0] == build['apk_sha256']
        value = {'installed': True, 'apk_sha256': build['apk_sha256'], 'own_install_confirmed': clicks, 'product_apk_unchanged': True}
    else:
        assert path.startswith('package:/data/app/') and path.endswith('/base.apk')
        assert run(['shell', 'sha256sum', path[8:]]).split()[0] == build['apk_sha256']
        if args.mode == 'cleanup':
            assert run(['uninstall', PKG]) == 'Success'
            assert 'package:' + PKG not in run(['shell', 'pm', 'list', 'packages', PKG]).splitlines()
            value = {'diagnostic_package_removed': True, 'product_apk_unchanged': True}
        else:
            assert args.fixture_ms and abs(time.time()*1000-args.fixture_ms) < 3600000
            # This stop is restricted to our diagnostic UID, never the product.
            run(['shell', 'am', 'force-stop', PKG])
            output = run(['shell', 'am', 'instrument', '-w', '-e', 'mode', args.mode, '-e', 'fixture_ms', str(args.fixture_ms), PKG + '/' + build['instrumentation']], 60)
            fields = dict(re.findall(r'^INSTRUMENTATION_RESULT: ([a-z_]+)=(.*)$', output, re.M))
            assert fields.get('passed') == 'true', {k: fields[k] for k in ['passed', 'error', 'failure_class', 'checks'] if k in fields}
            value = json.loads(fields['audit'])
            assert value['isolated_uid'] and value['own_uid'] != value['product_uid'] and not value['product_settings_accessed'] and not value['official_account_read'] and not value['microphone_started'] and not value['playback_started']
    (STAGE / (args.mode + '-report.json')).write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps(value))

if __name__ == '__main__':
    main()
