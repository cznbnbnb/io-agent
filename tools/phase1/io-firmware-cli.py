"""Pinned suggest60 firmware operator. Explicit start only; never auto-retries OTA.

HDC carries local commands to the already authenticated App. It does not create
another BLE connection. Readback/receipt states are not proof of lens duration.
"""
import argparse, hashlib, importlib.util, json, re, subprocess, time, uuid, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PRIVATE=ROOT/'rebuild/phase1/device-private/firmware126'
REMOTE='data/storage/el2/base/haps/entry/files'
BUNDLE='org.turboio.harmony.research'
SHA='fcbc2d80bca5e64a2e1b1513c63bc0fe4527a85efe2751093bdc6235f8171cd9'
ZIP=ROOT/'rebuild/phase1/device-private/stock-firmware-1.0.5.5/suggestion60-candidate/StrixOS-1.0.5.5-SUGGEST60-OFFLINE-01-UNFLASHED.zip'
spec=importlib.util.spec_from_file_location('io_card_transfer',Path(__file__).with_name('io-card-cli.py'))
transport=importlib.util.module_from_spec(spec);spec.loader.exec_module(transport)

def proofs():
    text=(ROOT/'rebuild/harmony-sdk/entry/src/main/ets/FirmwareOtaCandidate.ets').read_text(encoding='utf8')
    rows=re.findall(r"\{name:'([A-Za-z0-9_.-]+)',size:(\d+),sha256:'([a-f0-9]{64})'\}",text)
    if len(rows)!=16 or len({r[0] for r in rows})!=16 or SHA not in text:raise ValueError('OTA_PROOF_SET')
    return {n:(int(s),h) for n,s,h in rows}

def validate_zip(path=ZIP):
    if path.is_symlink() or path.stat().st_size!=8735334 or hashlib.sha256(path.read_bytes()).hexdigest()!=SHA:raise ValueError('OTA_ZIP_HASH')
    expected=proofs()
    with zipfile.ZipFile(path) as z:
        if set(z.namelist())!=set(expected) or len(z.infolist())!=16:raise ValueError('OTA_ZIP_MEMBERS')
        for name,(size,sha) in expected.items():
            raw=z.read(name)
            if len(raw)!=size or hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('OTA_MEMBER_HASH')
    return expected

def command(action,binding='',inspection='',now=None,identifier=None):
    if action not in ('status','prepare','start','reconnect','recover-link','readback','release'):raise ValueError('OTA_ACTION')
    if action in ('start','release') and not re.fullmatch(r'[a-f0-9]{64}',binding):raise ValueError('OTA_FRESH_BINDING_REQUIRED')
    if action=='release' and inspection!='readback_verified_release_for_lens_check':raise ValueError('OTA_RELEASE_NOT_LENS_SUCCESS')
    if action=='recover-link' and (not re.fullmatch(r'fw-[a-f0-9]{32}',binding) or inspection!='user_observed_setup_after_reported_transfer_failure'):raise ValueError('OTA_RECOVERY_EVIDENCE_REQUIRED')
    ident=identifier or 'fw-'+uuid.uuid4().hex
    if not re.fullmatch(r'fw-[a-f0-9]{32}',ident):raise ValueError('OTA_ID')
    return dict(schema=1,id=ident,action=action,expires_at=int((time.time() if now is None else now)*1000)+60000,candidate_sha256=SHA,expected_binding=binding,inspection=inspection)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['stage','snapshot','status','prepare','start','reconnect','recover-link','readback','release','receipt'])
    p.add_argument('--hdc',default='D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe')
    p.add_argument('--device');p.add_argument('--binding',default='');p.add_argument('--id',default='');p.add_argument('--inspection',default='')
    a=p.parse_args();PRIVATE.mkdir(exist_ok=True)
    devices=subprocess.check_output([a.hdc,'list','targets'],timeout=15).decode().strip().splitlines()
    if not a.device:
        if len(devices)!=1 or '[Empty]' in devices[0]:raise ValueError('OTA_SINGLE_PHONE_REQUIRED')
        a.device=devices[0]
    def recv(name):
        if not re.fullmatch(r'(firmware-status|fw-[a-f0-9]{32})\.json',name):raise ValueError('OTA_REMOTE_PATH')
        local=PRIVATE/name
        if not transport.transfer(a.hdc,a.device,'recv',REMOTE+'/io-debug/'+name,local):raise ValueError('OTA_RECEIPT_UNAVAILABLE_NO_REPLAY')
        if local.stat().st_size>16384:raise ValueError('OTA_RECEIPT_SIZE')
        return json.loads(local.read_text(encoding='utf-8-sig'))
    if a.action=='stage':
        expected=validate_zip();folder=PRIVATE/'payloads';folder.mkdir(exist_ok=True)
        made=subprocess.run([a.hdc,'-t',a.device,'shell','-b',BUNDLE,'mkdir','-p',REMOTE+'/firmware-suggest60'],capture_output=True,timeout=15)
        if made.returncode or made.stdout.strip() or made.stderr.strip():raise ValueError('OTA_STAGE_DIRECTORY_NO_START')
        with zipfile.ZipFile(ZIP) as z:
            for name in expected:
                local=folder/name
                if local.is_symlink():raise ValueError('OTA_STAGE_SYMLINK')
                local.write_bytes(z.read(name))
                if not transport.transfer(a.hdc,a.device,'send',local,REMOTE+'/firmware-suggest60/'+name):raise ValueError('OTA_STAGE_TRANSFER_NO_START')
        print(json.dumps({'stage':'phone_files_staged','members':len(expected),'candidate_sha256':SHA,'flash_started':False}));return
    if a.action=='snapshot':result=recv('firmware-status.json')
    elif a.action=='receipt':
        if not re.fullmatch(r'fw-[a-f0-9]{32}',a.id):raise ValueError('OTA_ID')
        result=recv(a.id+'.json')
    else:
        c=command(a.action,a.binding,a.inspection);local=PRIVATE/(c['id']+'-command.json');local.write_text(json.dumps(c),encoding='utf8')
        # Local intent retained before HDC; uncertain publication is never retried.
        if not transport.transfer(a.hdc,a.device,'send',local,REMOTE+'/io-debug/firmware-command.json'):raise ValueError('OTA_COMMAND_PUBLICATION_UNKNOWN_NO_REPLAY')
        result={'id':c['id'],'state':'unknown','action':a.action}
        for _ in range(8):
            time.sleep(1)
            try:result=recv(c['id']+'.json')
            except ValueError:continue
            if result.get('state') in ('complete','error'):break
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
