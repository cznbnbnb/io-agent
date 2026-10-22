"""Bounded read-only observation of one already-running isolated phone trial."""
import argparse
import json
import re
import subprocess
import time
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--journal',required=True,type=Path)
p.add_argument('--seconds',type=int,default=50)
a=p.parse_args();assert 5<=a.seconds<=600
private=Path('rebuild/phase1/device-private').resolve();target=a.journal.resolve()
assert target.parent==private and re.fullmatch(r'[a-z0-9-]+\.json',target.name)
initial=json.loads(target.read_text(encoding='utf-8-sig'))
assert initial['kind']=='p22_actual_daily_coordinator'
assert re.fullmatch(r'/data/storage/el2/base/haps/entry/files/p22-daily-lab/run-[0-9]{13}',initial['root'])
identity=(initial['root'],initial['attemptStarted']);temporary=target.with_suffix('.recv.json')
hdc='D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe'
remote='/data/app/el2/100/base/org.turboio.harmony.research/haps/entry/files/p22-daily-lab/trial.json'
deadline=time.monotonic()+a.seconds;last_at=-1
while time.monotonic()<deadline:
    try:
        transfer=subprocess.run([hdc,'file','recv',remote,str(temporary)],capture_output=True,timeout=8)
        assert transfer.returncode==0
        row=json.loads(temporary.read_text(encoding='utf-8-sig'));assert (row['root'],row['attemptStarted'])==identity
        sample=row['samples'][-1]
        alive=subprocess.run([hdc,'shell','pidof','org.turboio.harmony.research'],capture_output=True,timeout=8)
        process_seen=bool(re.fullmatch(rb'\s*\d+(?:\s+\d+)*\s*',alive.stdout))
        target.write_text(json.dumps(row,ensure_ascii=False),encoding='utf-8')
        if sample['at']!=last_at or row['finished']:
            last_at=sample['at'];print(json.dumps({'phase':row['phase'],'finished':bool(row['finished']),
                'process_seen':process_seen,'sample_at':last_at,'capture':sample['capture'],'audio_payload_bytes':sample['bytes'],
                'current_job':sample['currentJob'],'queued':sample['queued'],'windows':len(sample['windows']),
                'core_end':max((w['end'] for w in sample['windows']),default=0),
                'screen_off_observed':sample['screenKnown'] and not sample['screenActive']}),flush=True)
        if row['finished']:break
        if not process_seen:
            print(json.dumps({'observation':'process_missing','action':'no_restart'}),flush=True);break
    except (OSError,ValueError,KeyError,IndexError,AssertionError,subprocess.TimeoutExpired):
        print(json.dumps({'observation':'read_failed','action':'no_restart'}),flush=True)
    time.sleep(5)
else:print(json.dumps({'observation':'bounded_observation_ended','action':'no_restart'}),flush=True)
