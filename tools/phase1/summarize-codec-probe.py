"""Verify finite native PCM diagnostic metadata; no audio, words or source IDs."""
import argparse
import hashlib
import json
import re
from pathlib import Path

p=argparse.ArgumentParser()
for key in ['root','original','manifest','output']:p.add_argument('--'+key,required=True,type=Path)
a=p.parse_args()
read=lambda path:json.loads(path.read_text(encoding='utf-8-sig'))
r=read(a.root/'codec-window-probe.json');m=read(a.manifest);result=r['result']
assert r['schema']==1 and r['kind']=='p22_native_pcm_equivalence' and r['finished']>=r['started']
audio=list((a.root/'lifelog').rglob('audio.ogg'));assert len(audio)==1
digest=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
same_source=digest(audio[0])==digest(a.original)==r['sourceSha256']
frames=result['frames'];assert type(frames) is int and 0<frames<=2000
expected=[(max(0,cursor-83),min(frames,cursor+167+83)) for cursor in range(0,frames,167)]
windows=result['windows'];assert len(windows)==len(expected) and result['capacityFrames']==512
out_windows=[]
for w,(start,end) in zip(windows,expected):
    assert (w['start'],w['end'])==(start,end)
    assert all(re.fullmatch(r'[a-f0-9]{64}',w[k]) for k in ['referenceSha256','cachedSha256'])
    assert all(type(w[k]) is int and 0<=w[k]<=2000 for k in ['decodedFrames','reusedFrames','replayedFrames','retainedFrames'])
    assert w['retainedFrames']<=512
    assert w['decodedFrames']+w['reusedFrames']-w['replayedFrames']==end-start
    equal=w['referenceSha256']==w['cachedSha256'];assert equal==w['equal']
    out_windows.append({k:w[k] for k in ['start','end','equal','referenceSha256','cachedSha256','decodedFrames','reusedFrames','replayedFrames','retainedFrames']})
verified=r['phase']=='verified' and result['equivalent'] and same_source and all(w['equal'] for w in out_windows)
out={'kind':r['kind'],'version':m['version'],'signed_hap_sha256':m['signed_hap_sha256'],
     'started':r['started'],'finished':r['finished'],'elapsed_ms':r['finished']-r['started'],
     'source_sha256':r['sourceSha256'],'original_and_copy_unchanged':same_source,'frames':frames,
     'capacity_frames':512,'maximum_retained_pcm_bytes':512*960*4,
     'rolling_native_decoded_frames':sum(w['decodedFrames'] for w in windows),
     'reference_native_decoded_frames':sum(w['end'] for w in windows),
     'windows':out_windows,'verified':verified,
     'scope':{'real_native_pcm_digest_comparison':True,'new_acquisition':False,'asr_or_accuracy_verified':False,
              'long_source_or_eight_hour_verified':False,'total_process_memory_bound_verified':False}}
a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:out[k] for k in ['version','verified','frames','rolling_native_decoded_frames','reference_native_decoded_frames','elapsed_ms']}))
