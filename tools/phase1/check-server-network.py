"""Read-only network/redirect diagnosis, with no business tokens or DB reads."""
import contextlib
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import runpy
import socket
import ssl
import sys
import winreg

sys.path.append('C:/Users/LENOVO/AppData/Local/Programs/Python/Python310/Lib/site-packages')
root = Path(__file__).resolve().parents[2]
report = {'at': datetime.now(timezone.utc).isoformat(), 'scope': 'read-only TCP/TLS, HTTP redirect, listener and host firewall checks'}

class Quiet(io.StringIO):
    def reconfigure(self, **kwargs):
        pass

report['direct_ports'] = {}
for port in [80, 443]:
    try:
        with socket.create_connection(('43.142.59.131', port), timeout=4):
            report['direct_ports'][str(port)] = 'connected'
    except Exception as error:
        report['direct_ports'][str(port)] = type(error).__name__
try:
    with socket.create_connection(('43.142.59.131', 80), timeout=4) as conn:
        conn.sendall(b'HEAD / HTTP/1.1\r\nHost: cznbnb.cn\r\nConnection: close\r\n\r\n')
        data = conn.recv(8192).decode('iso-8859-1')
        report['public_http'] = [line for line in data.split('\r\n') if line.startswith('HTTP/') or line.lower().startswith('location:')]
except Exception as error:
    report['public_http_error'] = type(error).__name__
try:
    with socket.create_connection(('cznbnb.cn', 443), timeout=4) as raw:
        with ssl.create_default_context().wrap_socket(raw, server_hostname='cznbnb.cn') as conn:
            conn.sendall(b'GET /io-api/v1/identity HTTP/1.1\r\nHost: cznbnb.cn\r\nConnection: close\r\n\r\n')
            report['public_https'] = conn.recv(1024).split(b'\r\n', 1)[0].decode()
    with socket.create_connection(('cznbnb.cn', 443), timeout=4) as raw:
        with ssl.create_default_context().wrap_socket(raw, server_hostname='cznbnb.cn') as conn:
            conn.sendall(b'HEAD / HTTP/1.1\r\nHost: cznbnb.cn\r\nConnection: close\r\n\r\n')
            report['public_site_https'] = conn.recv(1024).split(b'\r\n', 1)[0].decode()
except Exception as error:
    report['public_https_error'] = type(error).__name__
try:
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
        enabled = winreg.QueryValueEx(key, 'ProxyEnable')[0]
        proxy = str(winreg.QueryValueEx(key, 'ProxyServer')[0]).split('@')[-1]
        report['system_proxy'] = {'enabled': bool(enabled), 'server': proxy}
except OSError:
    pass
connection = None
try:
    with contextlib.redirect_stdout(Quiet()), contextlib.redirect_stderr(Quiet()):
        helper = runpy.run_path('D:/Project/Kimi_Agent_手持娱乐值网站/app/.deploy/ssh.py', run_name='io_network_readonly')
        profiles = [profile for profile in helper['PROFILES'].values() if profile.get('host') == '43.142.59.131']
        if len(profiles) != 1:
            raise RuntimeError('WRONG_HOST')
        helper['connect'].__globals__['P'] = profiles[0]
        connection = helper['connect']()
    commands = {
        'listeners': "ss -ltn '( sport = :80 or sport = :443 or sport = :3401 )'",
        'nginx_entry_directives': "sudo -n nginx -T 2>/dev/null | grep -E '^ *([[:space:]]*)(listen|server_name|return|location|proxy_pass) '",
        'old_nginx_entry_directives': "sudo -n cat /root/nginx-ev.backup-2026-10-11-2359.conf | grep -E '^ *([[:space:]]*)(listen|server_name|return|location|proxy_pass) '",
        'host_firewall_ufw': 'sudo -n ufw status',
        'host_firewall_ipv4': 'sudo -n iptables -S',
        'local_site_http': "curl --silent --max-time 4 -I -H 'Host: cznbnb.cn' http://127.0.0.1/ | grep -Ei '^(HTTP/|Location:)'",
        'local_site_https_status': "curl --silent --max-time 4 --resolve cznbnb.cn:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://cznbnb.cn/",
        'local_api_https_status': "curl --silent --max-time 4 --resolve cznbnb.cn:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://cznbnb.cn/io-api/v1/identity",
    }
    report['server'] = {}
    for name, command in commands.items():
        stdin, stdout, stderr = connection.exec_command(command, timeout=15)
        value = stdout.read(16384).decode('utf-8', 'replace').strip()
        if name == 'host_firewall_ipv4':
            value = '\n'.join(line for line in value.splitlines() if line.startswith('-P ') or line.startswith('-A INPUT ') or '--dport 443 ' in line)
        stderr.read(4096)
        report['server'][name] = {'exit_code': stdout.channel.recv_exit_status(), 'result': value}
except Exception as error:
    report['ssh_error'] = type(error).__name__
finally:
    if connection is not None:
        connection.close()
(root/'rebuild/phase1/server-network-diagnosis-2026-10-12.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
