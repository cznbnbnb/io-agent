"""Export ASR timing metadata only; keep paths, recognized words and embeddings private."""
import argparse
import json
import math
import re
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('log',type=Path);p.add_argument('output',type=Path)
p.add_argument('--version',required=True);p.add_argument('--hap-sha256',required=True)
p.add_argument('--source-sha256',required=True);p.add_argument('--since',type=int,required=True)
a=p.parse_args()
assert re.fullmatch(r'0\.1\.\d+',a.version) and a.since>=0
assert all(re.fullmatch(r'[a-fA-F0-9]{64}',s) for s in [a.hap_sha256,a.source_sha256])
assert a.log.stat().st_size<=10000000
events=[]
for line in a.log.read_text(encoding='utf-8-sig').splitlines():
    try:r=json.loads(line)
    except (ValueError,TypeError):continue
    at=r.get('t');event=r.get('ev')
    if type(at) is not int or at<a.since or event not in ['run-start','run-timing','window-alignment','ogg-index','pcm-window','fail']:continue
    if event=='fail':
        message=r.get('x','')
        code='worker_response_timeout' if message=='转写线程响应超时' else message if re.fullmatch(r'[A-Z0-9_]{1,100}',message) else 'details_kept_private'
        events.append({'at':at,'event':event,'code':code});continue
    try:raw=json.loads(r['x'])
    except (ValueError,TypeError,KeyError):continue
    out={'at':at,'event':event}
    for key in ['worker','includeSpeakers','reset']:
        if type(raw.get(key)) is bool:out[key]=raw[key]
    for key in ['frames','prefixFrames','modelsMs','elapsedMs','recognitionMs','embeddingMs','timerYields','timerWaitMs','aligned','unverified','rawTokens','ownedTokens','pages','scannedPages','reusedFrames','blockBytes','decodedFrames','replayedFrames','retainedFrames','capacityFrames']:
        value=raw.get(key)
        if type(value) in [int,float] and math.isfinite(value) and 0<=value<=600000:out[key]=value
    if event=='window-alignment' and raw.get('state') in ['unverified','token_starts','no_speech']:out['state']=raw['state']
    events.append(out)
assert len(events)<=1000
out={'kind':'p22_worker_timing','version':a.version,'signed_hap_sha256':a.hap_sha256.lower(),
     'source_sha256':a.source_sha256.lower(),'since_device_epoch_ms':a.since,'events':events,
     'scope':{'native_cpu_hard_cap_verified':False,'accuracy_verified':False,
              'recognized_words_audio_ids_embeddings':'kept private'}}
a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'version':a.version,'events':len(events),'timed_runs':sum(e['event']=='run-timing' for e in events)}))
