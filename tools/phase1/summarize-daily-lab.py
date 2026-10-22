"""Publish only bounded diagnostic metadata; never text, embeddings or source IDs."""
import argparse
import json
import re
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('journal',type=Path);p.add_argument('output',type=Path)
p.add_argument('--version',required=True);p.add_argument('--hap-sha256',required=True)
args=p.parse_args()
assert re.fullmatch(r'0\.1\.\d+',args.version)
assert re.fullmatch(r'[a-fA-F0-9]{64}',args.hap_sha256)
r=json.loads(args.journal.read_text(encoding='utf-8-sig'))
assert r['schema']==1 and r['kind']=='p22_actual_daily_coordinator'
assert len(r['samples'])<=100
samples=[]
attempt_started=r.get('attemptStarted',r['created'])
attempt_known='attemptStarted' in r and attempt_started>0
for raw in r['samples']:
    if attempt_known and raw['at']<attempt_started:continue
    row={key:raw[key] for key in ['at','capture','bytes','currentJob','queued','foreground','lease','screenKnown','screenActive','battery','charging','thermal','freeBytes']}
    row['sources']=[{key:s[key] for key in ['bytes','frames','complete','interrupted','textComplete']} for s in raw['sources']]
    row['queue']=[{'status':s['status'],'attempts':s['attempts'],
                   'lastError':s['lastError'] if re.fullmatch(r'[A-Za-z0-9_-]{0,100}',s['lastError']) else 'details_kept_private'} for s in raw['queue']]
    row['windows']=[{key:s[key] for key in ['start','end','sourceFrames','utterances']} for s in raw['windows']]
    row['materials']=[{key:s[key] for key in ['revision','textRevision','utterances','textChars','sourceComplete']} for s in raw['materials']]
    for row_material,raw_material in zip(row['materials'],raw['materials']):
        state=raw_material.get('speakerProcessing','unknown')
        row_material['speakerProcessing']=state if state in ['unknown','pending','processed','unavailable'] else 'unknown'
    for group in ['windows','materials']:
        for safe,original in zip(row[group],raw[group]):
            state=original.get('boundaryProcessing','unknown')
            safe['boundaryProcessing']=state if state in ['unknown','unverified','token_starts','no_speech'] else 'unknown'
    samples.append(row)
first_window=next((s['at'] for s in samples if s['windows']),None)
first_words=next((s['at'] for s in samples if any(m['utterances'] for m in s['materials'])),None)
def received(s):
    return s['bytes']>0 or any(source['frames']>0 for source in s['sources'])
actual_capture=any(s['capture'] and received(s) for s in samples)
error=r.get('error','')
out={'schema':1,'version':args.version,'signed_hap_sha256':args.hap_sha256.lower(),
     'kind':r['kind'],'phase':r['phase'],'error':error if re.fullmatch(r'[A-Za-z0-9_-]{0,100}',error) else 'details_kept_private',
     'attempt_started':attempt_started,'attempt_period_known':attempt_known,
     'observation_period':'current_attempt' if attempt_known else 'accumulated_history_may_include_previous_attempts',
     **{key:r[key] for key in ['created','captureDeadline','deadline','captureStopped','finished','modelLoadMs']},
     'observations':{
         'samples':len(samples),'capture_samples':sum(s['capture'] for s in samples),
         'received_audio_capture_samples':sum(s['capture'] and received(s) for s in samples),
         'known_screen_off_samples':sum(s['screenKnown'] and not s['screenActive'] for s in samples),
         'known_screen_off_capture_samples':sum(s['screenKnown'] and not s['screenActive'] and s['capture'] for s in samples),
         'known_screen_off_received_audio_capture_samples':sum(s['screenKnown'] and not s['screenActive'] and s['capture'] and received(s) for s in samples),
         'capture_and_job_sampled_together':sum(s['capture'] and s['currentJob'] for s in samples),
         'committed_window_observed_during_capture':any(s['capture'] and received(s) and s['windows'] for s in samples),
         'recognized_utterances_observed_during_capture':any(s['capture'] and received(s) and any(m['utterances'] for m in s['materials']) for s in samples),
         'first_window_observed_at':first_window,'first_words_observed_at':first_words,
     },'samples':samples,
     'scope':{'real_acquisition_and_production_coordinator':actual_capture,
              'production_coordinator_used':True,'current_attempt_capture_observed':actual_capture,
              'capture_flag_means':'capture_intent_enabled_including_wait_for_wake',
              'summary_and_upload_disabled':True,
              'recognition_accuracy_verified':False,'speaker_identity_verified':False,'eight_hour_power_verified':False,
              'raw_audio_text_ids_embeddings':'private ignored directory only'}}
replay_hash=r.get('replaySourceSha256','')
if re.fullmatch(r'[a-f0-9]{64}',replay_hash):out['replay_source_sha256']=replay_hash
out['scope']['saved_source_replay']='replay_source_sha256' in out
args.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'phase':out['phase'],'error':out['error'],'observations':out['observations']},ensure_ascii=False))
