"""Export only synthetic P10 event metadata from our bundle's UI dump."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
p=argparse.ArgumentParser(); p.add_argument('layout',type=Path); p.add_argument('output',type=Path); args=p.parse_args()
raw=args.layout.read_bytes(); tree=json.loads(raw); labels=[]
def walk(node):
    text=node.get('attributes',{}).get('text','')
    if text: labels.append(text)
    for child in node.get('children',[]):walk(child)
walk(tree)
events=[]; phases=[]
for text in labels:
    if re.match(r'^(idle|ready|failed|retrying|connecting|authenticating|permission|initializing) · ',text):phases.append(text.split(' · ',1)[0])
    for line in text.splitlines():
        try: event=json.loads(line)
        except (ValueError,TypeError):continue
        if not isinstance(event,dict) or not re.fullmatch(r'p10-[a-z0-9]+-[a-z0-9]+-[a-f0-9]{16}',str(event.get('uid',''))):continue
        if not isinstance(event.get('at'),int) or event.get('cmd') not in (0,1,2):continue
        if not isinstance(event.get('type'),int) or not re.fullmatch(r'[a-z0-9-]{1,40}',str(event.get('event',''))):continue
        events.append({k:event[k] for k in ['at','event','type','uid','cmd','phase'] if k in event})
report={'captured_at_utc':datetime.now(timezone.utc).isoformat(), 'kind':'device_ui_readonly',
        'bundle':'org.turboio.harmony.research','lab_page_seen':any(t.startswith(('P10 原厂建议卡实验', 'P10/P12 隔离实验')) for t in labels),
        'daily_lab_page_seen':any(t.startswith('P22 日常调度隔离实验') for t in labels),
        'transport_stages':[t.removeprefix('蓝牙阶段：') for t in labels if re.fullmatch(r'蓝牙阶段：[a-z-]{1,30}',t)],
        'scan_address_matches':sum('与保存地址一致' in t for t in labels),
        'scan_other_addresses':sum('与保存地址不同' in t for t in labels),
        'scan_status':[t for t in labels if re.fullmatch(r'扫描中 · 15 秒自动停止|扫描结束 · \d+ 个候选（未认证）|扫描未启动 · 错误码 \d+|请先在系统设置开启蓝牙',t)],
        'connection_phases':phases,'events':events,'raw_layout_sha256':hashlib.sha256(raw).hexdigest(),
        'raw_layout':'kept locally under ignored device-private; no user audio or other apps'}
args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
