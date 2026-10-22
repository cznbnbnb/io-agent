"""Read-only inventory: no raw audio, notification text, credentials or device IDs."""
import hashlib
import json
from pathlib import Path
import zipfile
import os
root=Path(__file__).resolve().parents[2]
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def entry(path):
    return {'path':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,'sha256':sha(path)}
paths=[root/'com.rayneo.venus.pub.apk']
paths+=list(root.glob('TurboIO*.hap'))
paths+=list((root/'rebuild/artifacts').glob('*.hap'))
paths+=list((root/'rebuild/artifacts').glob('installed-*/*.hap'))
paths+=list((root/'rebuild/phase1/artifacts').glob('*.hap'))
report={'date':'2026-10-10','git_baseline':'149cbbc','device_observations':[
    {'phase':'early_session','targets':0},
    {'phase':'2026-10-10 21:48:56 +08:00','targets':1,'bundle':'org.turboio.harmony.research','installed_version':'0.1.15','version_code':10015,'pidof_output':'empty; not treated as lifecycle proof','actions':'read-only; no launch/install/card/settings'}
], 'artifacts':[],'models':[],'evidence':[]}
install_log=root/'rebuild/phase1/device-install.log'
if install_log.exists() and 'install bundle successfully' in install_log.read_text(encoding='utf-8-sig'):
    report['device_observations'].append({'phase':'2026-10-11 00:27 +08:00','action':'in-place development candidate upgrade; no uninstall or data clear','installed_version':'0.1.16','version_code':10016,'ability':'SuggestionLabAbility','ability_start':'confirmed','card_display':'not_yet_verified'})
for p in paths:
    item=entry(p)
    if p.suffix=='.hap':
        with zipfile.ZipFile(p) as z:
            if 'pack.info' in z.namelist():
                try:item['pack_info']=json.loads(z.read('pack.info'))['summary']['app']
                except (ValueError,KeyError):pass
    report['artifacts'].append(item)
for p in (root/'rebuild/harmony-sdk/entry/src/main/resources/rawfile/models').rglob('*'):
    if p.is_file():report['models'].append(entry(p))
evidence=root/'rebuild/device-test/2026-10-10'
selected=['device-report.json','brightness-evidence.json','background-readonly-check.md','v15-lifelog-test-result-layout.json','v15-recording-archive-layout.json','v15-day-cleanup-before-layout.json']
for name in selected:
    p=evidence/name
    if not p.exists():continue
    item=entry(p)
    if name.endswith('layout.json'):
        d=json.loads(p.read_text(encoding='utf-8')); labels=[]
        def walk(node):
            t=node.get('attributes',{}).get('text','')
            if t and any(k in t for k in ['6 路接收','已排队，等待','未检测到有效语音','本机转写完成','本地转写完成','未收到音频']):labels.append(t[:100])
            for child in node.get('children',[]):walk(child)
        walk(d);item['status_labels_only']=labels
    report['evidence'].append(item)
stage=Path(os.environ['TEMP'])/'TurboIO-phase1-01a125f7/harmony-sdk'
checked=[]; missing=[]; different=[]
for folder in ['entry/src','turbo_core/src','AppScope']:
    for p in (root/'rebuild/harmony-sdk'/folder).rglob('*'):
        if not p.is_file():continue
        rel=p.relative_to(root/'rebuild/harmony-sdk'); q=stage/rel
        checked.append(rel.as_posix())
        if not q.exists():missing.append(rel.as_posix())
        elif sha(p)!=sha(q):different.append(rel.as_posix())
report['compiled_source_check']={'files_checked':len(checked),'missing':missing,'different':different,'passed':bool(checked) and not missing and not different}
(root/'rebuild/phase1/baseline-inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'artifacts':len(report['artifacts']),'models':len(report['models']),'evidence':len(report['evidence'])}))
